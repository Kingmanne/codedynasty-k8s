# Phase 2: Containers on Kubernetes

The four CodeDynasty Lambda functions rebuilt as Express services, packaged as
Docker images, and running on the k3s node with PostgreSQL.

## What's new

| Path | What it is |
|---|---|
| `services/signup-api/` | `POST /signup`: validates, hashes the password, queues on SQS, returns 202 |
| `services/signup-worker/` | Long-polls SQS, inserts the user into PostgreSQL, deletes the message |
| `services/login/` | `POST /login`: checks the password with bcrypt |
| `services/list-users/` | `GET /users`: lists users without password hashes |
| `k8s/` | Namespace, ConfigMap, PostgreSQL StatefulSet, Deployments, Services, Ingress |
| `k8s/kustomization.yaml` | Applies everything at once and sets image tags in one place |
| `terraform/sqs.tf` | Signup queue + DLQ, node IAM policy for SQS, DLQ alarm by email |
| `terraform/user_data.sh.tftpl` | Node now installs the ECR credential provider so k3s can pull from ECR |
| `terraform/compute.tf` | IMDS hop limit 2, so Pods can use the node's IAM role |
| `scripts/build-and-push.sh` | Builds all images for linux/amd64 and pushes them to ECR |

Every service has `/health` (liveness) and `/ready` (readiness; checks the
database where one is used), handles `SIGTERM` gracefully, logs JSON, and runs
as a non-root user with a read-only filesystem.

**Change from the Lambda version:** the password is hashed in `signup-api`
before it's queued, so plain-text passwords never sit in SQS.

## Steps

### 1. Install Docker on the Mac (once)

```bash
brew install colima docker docker-buildx
mkdir -p ~/.docker/cli-plugins
ln -sfn $(brew --prefix)/opt/docker-buildx/bin/docker-buildx ~/.docker/cli-plugins/docker-buildx
colima start --cpu 4 --memory 6 --vm-type vz --vz-rosetta
docker buildx version
```

`--vz-rosetta` makes building x86 (amd64) images on Apple Silicon much faster.

### 2. Start the node and update the infrastructure

```bash
aws ec2 start-instances --instance-ids <instance_id> --region eu-west-2
cd terraform
terraform plan
```

Expect: **the EC2 instance is replaced** (its start-up script changed), plus the
new queues, IAM policy, SNS topic and alarm. The cluster is still empty, so a
rebuild costs nothing. Then `terraform apply`, and confirm the new SNS email.

### 3. Refresh kubeconfig (the new node has new certificates)

Use the `instance_id` from the Terraform outputs:

```bash
CMD_ID=$(aws ssm send-command --region eu-west-2 --instance-ids <instance_id> --document-name AWS-RunShellScript --parameters 'commands=["cat /etc/rancher/k3s/k3s.yaml"]' --query Command.CommandId --output text)
aws ssm get-command-invocation --region eu-west-2 --command-id $CMD_ID --instance-id <instance_id> --query StandardOutputContent --output text | sed 's/127.0.0.1/<node_public_ip>/' > ~/.kube/codedynasty.yaml
kubectl get nodes
```

Check the ECR credential provider installed:

```bash
aws ssm start-session --target <instance_id> --region eu-west-2
grep -i "ecr credential" /var/log/cloud-init-output.log
```

### 4. Build and push the images

```bash
cd ~/codedynasty-k8s
for s in signup-api signup-worker login list-users; do (cd services/$s && npm install --package-lock-only); done
chmod +x scripts/build-and-push.sh
./scripts/build-and-push.sh v0.1.0
```

### 5. Create the database password (not stored in Git)

```bash
kubectl create namespace codedynasty
kubectl create secret generic postgres-credentials -n codedynasty \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -base64 24)"
```

Phase 3 replaces this with External Secrets reading AWS SSM.

### 6. Deploy

```bash
kubectl apply -k k8s/ --dry-run=server
kubectl apply -k k8s/
kubectl get pods -n codedynasty -w
```

Wait until all five Pods are `Running` and `1/1` ready (Ctrl+C to stop watching).

### 7. Test end to end

```bash
curl -X POST http://<node_public_ip>/signup -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"password123"}'
curl http://<node_public_ip>/users
curl -X POST http://<node_public_ip>/login -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"password123"}'
```

Expected: `202`, then a list containing `test@example.com`, then `Login successful.`

## Troubleshooting

| Symptom | Check |
|---|---|
| `ImagePullBackOff` | `kubectl describe pod`; is the ECR credential provider installed (step 3)? Is the tag in `kustomization.yaml` pushed? |
| `CreateContainerConfigError` | The `postgres-credentials` Secret is missing (step 5) |
| signup-api returns 500 | `kubectl logs deploy/signup-api -n codedynasty`; usually SQS permissions or the IMDS hop limit |
| `/users` empty after signup | `kubectl logs deploy/signup-worker -n codedynasty` |
| Pod `Pending` | `kubectl describe pod`; not enough memory, see `kubectl top pods -A` |
