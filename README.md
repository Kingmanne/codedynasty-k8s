# CodeDynasty on Kubernetes (AWS + open source)

The CodeDynasty user-management app rebuilt on Kubernetes, mixing AWS managed
services with open-source tools. The original serverless version (SAM, Lambda)
lives in [Codedynasty-project](https://github.com/Kingmanne/Codedynasty-project).

| Part | Tool | Runs on |
|---|---|---|
| Infrastructure as Code | Terraform (state in S3) | AWS |
| Cluster | k3s on one EC2 instance | AWS |
| Images | ECR | AWS |
| Queue + DLQ | SQS | AWS |
| Worker autoscaling | KEDA (scales on SQS queue length) | Kubernetes |
| Database | PostgreSQL | Kubernetes |
| Secrets | SSM Parameter Store + External Secrets Operator | AWS → Kubernetes |
| Ingress | Traefik (built into k3s) | Kubernetes |
| Frontend | S3 + CloudFront | AWS |
| CI | GitHub Actions (test, build, Trivy scan, push) | GitHub |
| CD | Argo CD (GitOps) | Kubernetes |
| Monitoring | Prometheus + Grafana | Kubernetes |

## Phases

- [ ] **Phase 1 - Infrastructure:** VPC, EC2 + k3s, ECR, state bucket, budget alert
- [ ] Phase 2 - Containers: the four Lambda functions as Express apps with Dockerfiles
- [ ] Phase 3 - Data and queue: PostgreSQL, SQS, KEDA
- [ ] Phase 4 - Pipeline: GitHub Actions + Argo CD
- [ ] Phase 5 - Monitoring: Prometheus, Grafana, DLQ alert

## Phase 1: build the infrastructure

### What it creates

- VPC with one public subnet and an internet gateway. **No NAT gateway**, which saves about $30 a month.
- One EC2 instance (t3.medium, Ubuntu 24.04) that installs **k3s** on first boot.
- A fixed **Elastic IP**, so the address survives stop/start.
- Security group: ports 80/443 open to the internet, Kubernetes API (6443) open to **your IP only**, **no SSH port**. You connect with SSM Session Manager.
- IAM role for the node: SSM access + read-only ECR.
- Four **ECR** repositories with scan-on-push and a keep-last-10 lifecycle rule.
- An **AWS Budget** that emails you at 50%, 80% and 100% of $30 a month.

### Prerequisites

- Terraform 1.10 or later
- AWS CLI v2, logged in to your account (`aws sts get-caller-identity` works)
- The [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) for the AWS CLI
- kubectl

### Steps

```bash
# 1. Create the state bucket (once)
cd terraform/bootstrap
terraform init
terraform apply
# copy the "state_bucket" output

# 2. Point the main stack at that bucket
#    edit terraform/backend.tf -> bucket = "<state_bucket output>"

# 3. Set your variables
cd ..
cp terraform.tfvars.example terraform.tfvars
#    edit: my_ip_cidr (curl -s https://checkip.amazonaws.com, then add /32) and alert_email

# 4. Build it
terraform init
terraform plan
terraform apply
```

Then confirm the AWS Budgets email subscription in your inbox.

### Connect kubectl from your laptop

Wait about 2 minutes after `apply` for k3s to install, then:

```bash
# open a shell on the node
aws ssm start-session --target <instance_id> --region eu-west-2

# on the node: print the kubeconfig
sudo cat /etc/rancher/k3s/k3s.yaml
```

Copy that output into `~/.kube/codedynasty.yaml` on your laptop, change
`server: https://127.0.0.1:6443` to `server: https://<node_public_ip>:6443`, then:

```bash
export KUBECONFIG=~/.kube/codedynasty.yaml
kubectl get nodes   # should show one node, Ready
```

### Keep costs down

| Action | Command |
|---|---|
| Stop the node when you finish | `aws ec2 stop-instances --instance-ids <instance_id>` |
| Start it again | `aws ec2 start-instances --instance-ids <instance_id>` |
| Remove everything | `terraform destroy` |

A stopped instance costs only its disk (about $2–3 a month) plus the Elastic IP.

If your home IP changes, update `my_ip_cidr` in `terraform.tfvars` and run `terraform apply`.
