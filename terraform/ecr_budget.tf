# --- ECR: one private repository per service --------------------------------
resource "aws_ecr_repository" "service" {
  for_each = toset(var.ecr_repositories)

  name                 = "codedynasty/${each.key}"
  image_tag_mutability = "IMMUTABLE" # a tag always points to the same image
  force_delete         = true        # lets terraform destroy remove repos that still hold images

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Keep only the 10 newest images per repo, so storage stays near zero
resource "aws_ecr_lifecycle_policy" "service" {
  for_each   = aws_ecr_repository.service
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# --- Budget alert: emails you at 50%, 80% and 100% of the monthly limit -----
resource "aws_budgets_budget" "monthly" {
  name         = "codedynasty-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }
}
