# Phase 2.5: Public website

The CodeDynasty React frontend served from the cluster, so anyone can open the
site at `http://<node_public_ip>/`.

## How a visitor reaches the site

```
Browser -> http://16.60.54.233/            -> Traefik -> codedynasty-web Ingress -> frontend Service -> nginx Pod (React app)
React   -> http://16.60.54.233/api/signup  -> Traefik -> codedynasty-api Ingress -> strip "/api" -> signup-api (/signup)
```

The website and the API share one address, so the browser needs no CORS, and
the API lives under `/api` so it never clashes with the site's own `/signup`
and `/login` pages.

## What changed

| Area | Change |
|---|---|
| `frontend/` | Your React app, plus a two-stage `Dockerfile` (build with Node, serve with non-root nginx) and `nginx.conf` |
| `signup-api` | Takes a `name`; rejects duplicate emails (409); returns `{ user, token }` so the app opens the dashboard straight away |
| `signup-worker` | Saves the name; adds the `name` column to existing databases on start-up |
| `login` | Returns `{ user, token }` (a JWT valid for 12 hours) |
| `list-users` | `/users` now requires a valid login token and includes names; new `/config` returns feature flags from the ConfigMap (replaces AWS AppConfig) |
| `k8s/ingress.yaml` | Traefik `Middleware` that strips `/api`; one Ingress for the API, one for the website |
| `k8s/frontend/` | Deployment + Service for the frontend |
| `k8s/config.yaml` | `FEATURE_MAINTENANCE_MODE` and `FEATURE_SHOW_NEW_BANNER` flags |
| `terraform/variables.tf` | A fifth ECR repository: `codedynasty/frontend` |

Your frontend's source code is unchanged: the API address is set at build time
(`VITE_API_URL=/api` in the Dockerfile).

## Steps

```bash
aws ec2 start-instances --instance-ids <instance_id> --region eu-west-2

cd ~/codedynasty-k8s/terraform
terraform plan     # expect 2 to add: the frontend ECR repo and its lifecycle policy
terraform apply

cd ~/codedynasty-k8s
for s in signup-api signup-worker login list-users; do (cd services/$s && npm install --package-lock-only); done

kubectl create secret generic app-secrets -n codedynasty \
  --from-literal=JWT_SECRET="$(openssl rand -base64 48)"

./scripts/build-and-push.sh v0.2.0
kubectl apply -k k8s/ --dry-run=server
kubectl apply -k k8s/
kubectl get pods -n codedynasty -w
```

Then open `http://<node_public_ip>/` in a browser.

## Test from the terminal

```bash
curl -i -X POST http://<node_public_ip>/api/signup -H "Content-Type: application/json" -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"password123"}'
curl http://<node_public_ip>/api/users                 # 401: needs a token now
curl http://<node_public_ip>/api/config                # feature flags
```

## Turn on a feature flag

Edit `k8s/config.yaml` (for example `FEATURE_SHOW_NEW_BANNER: "true"`), then:

```bash
kubectl apply -k k8s/
kubectl rollout restart deployment/list-users -n codedynasty
```

Within 30 seconds the banner appears for every visitor, with no rebuild.
Environment variables are read when a container starts, which is why the
restart is needed.

## Next

A domain name and HTTPS: point a domain at the Elastic IP, then install
cert-manager to get free Let's Encrypt certificates for Traefik.
