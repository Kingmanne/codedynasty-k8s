#!/usr/bin/env bash
# Builds all five images (four services + the frontend) for the EC2 node (linux/amd64) and pushes them to ECR.
# Usage: ./scripts/build-and-push.sh v0.1.0
# Tags are immutable in ECR, so use a new tag every time (v0.1.1, v0.1.2, ...).
set -euo pipefail

TAG="${1:?Usage: ./scripts/build-and-push.sh <tag>, for example v0.1.0}"
REGION="eu-west-2"
SERVICES="signup-api signup-worker login list-users frontend"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

echo "Logging Docker in to $REGISTRY"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

for SERVICE in $SERVICES; do
  IMAGE="$REGISTRY/codedynasty/$SERVICE:$TAG"
  echo ""
  echo "=== Building $IMAGE"
  # --platform linux/amd64: your Mac is ARM, the t3.medium node is x86
  if [ "$SERVICE" = "frontend" ]; then CONTEXT="frontend"; else CONTEXT="services/$SERVICE"; fi
  docker buildx build --platform linux/amd64 --tag "$IMAGE" --push "$CONTEXT"
done

echo ""
echo "Done. Set newTag: $TAG for each image in k8s/kustomization.yaml, then:"
echo "  kubectl apply -k k8s/"
