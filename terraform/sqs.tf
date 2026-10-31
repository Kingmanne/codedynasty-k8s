# --- Signup queue + dead-letter queue -------------------------------------------
# The same pattern as CodeDynasty: signup-api sends here, signup-worker reads.
# After 3 failed attempts a message moves to the DLQ.

resource "aws_sqs_queue" "signup_dlq" {
  name                      = "codedynasty-signup-dlq"
  message_retention_seconds = 1209600 # 14 days to investigate failures
}

resource "aws_sqs_queue" "signup" {
  name                       = "codedynasty-signup-queue"
  visibility_timeout_seconds = 60
  receive_wait_time_seconds  = 20 # long polling by default

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.signup_dlq.arn
    maxReceiveCount     = 3
  })
}

# --- Let the node (and so its Pods) use the queues -----------------------------
# Only the actions the services need, only on these two queues.
resource "aws_iam_role_policy" "node_sqs" {
  name = "codedynasty-sqs"
  role = aws_iam_role.node.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SignupQueue"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",    # signup-api
          "sqs:ReceiveMessage", # signup-worker
          "sqs:DeleteMessage",  # signup-worker
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes", # KEDA in Phase 3
          "sqs:GetQueueUrl"
        ]
        Resource = aws_sqs_queue.signup.arn
      },
      {
        Sid      = "InspectDLQ"
        Effect   = "Allow"
        Action   = ["sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
        Resource = aws_sqs_queue.signup_dlq.arn
      }
    ]
  })
}

# --- Alarm when anything lands in the DLQ ----------------------------------------
resource "aws_sns_topic" "alerts" {
  name = "codedynasty-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "codedynasty-signup-dlq-not-empty"
  alarm_description   = "Signup messages failed 3 times and are waiting in the DLQ"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.signup_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
