output "node_public_ip" {
  description = "Fixed public IP of the k3s node"
  value       = aws_eip.node.public_ip
}

output "instance_id" {
  description = "Use with SSM Session Manager and to stop/start the node"
  value       = aws_instance.k3s.id
}

output "ecr_repository_urls" {
  description = "Push your images here"
  value       = { for name, repo in aws_ecr_repository.service : name => repo.repository_url }
}

output "connect_shell" {
  description = "Open a shell on the node (needs the Session Manager plugin)"
  value       = "aws ssm start-session --target ${aws_instance.k3s.id} --region ${var.region}"
}

output "stop_node" {
  description = "Stop the node when you finish for the day (saves most of the cost)"
  value       = "aws ec2 stop-instances --instance-ids ${aws_instance.k3s.id} --region ${var.region}"
}

output "signup_queue_url" {
  description = "Goes in k8s/config.yaml as SQS_QUEUE_URL"
  value       = aws_sqs_queue.signup.url
}

output "signup_dlq_url" {
  value = aws_sqs_queue.signup_dlq.url
}
