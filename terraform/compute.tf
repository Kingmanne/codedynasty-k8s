# A single EC2 instance running k3s (lightweight Kubernetes).

# Latest Ubuntu 24.04 LTS AMI, published by Canonical in SSM
data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# --- IAM role for the node -------------------------------------------------
resource "aws_iam_role" "node" {
  name = "codedynasty-k3s-node"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Lets you open a shell with SSM Session Manager (no SSH keys, no port 22)
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Lets the node pull images from your private ECR repositories
resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "node" {
  name = "codedynasty-k3s-node"
  role = aws_iam_role.node.name
}

# --- Fixed public IP ---------------------------------------------------------
# Allocated before the instance, so k3s can put it in its TLS certificate,
# and it stays the same when you stop and start the instance.
resource "aws_eip" "node" {
  domain = "vpc"
  tags   = { Name = "codedynasty-k3s" }
}

# --- The node ----------------------------------------------------------------
resource "aws_instance" "k3s" {
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.k3s.id]
  iam_instance_profile   = aws_iam_instance_profile.node.name

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    public_ip            = aws_eip.node.public_ip
    ecr_provider_version = var.ecr_credential_provider_version
  })
  user_data_replace_on_change = true

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
    encrypted   = true
  }

  metadata_options {
    http_tokens                 = "required" # IMDSv2 only (security best practice)
    http_put_response_hop_limit = 2          # lets Pods (one network hop further away) use the node's IAM role
  }

  tags = { Name = "codedynasty-k3s" }

  lifecycle {
    ignore_changes = [ami] # don't rebuild the node every time Ubuntu publishes a new AMI
  }
}

resource "aws_eip_association" "node" {
  instance_id   = aws_instance.k3s.id
  allocation_id = aws_eip.node.id
}
