#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
AWS_PROFILE_NAME="${AWS_PROFILE_NAME:-deploy-admin}"
AWS_REGION_NAME="${AWS_REGION_NAME:-us-east-2}"
FOUNDATION_STACK="${FOUNDATION_STACK:-dsp-operations-foundation}"
APPLICATION_STACK="${APPLICATION_STACK:-dsp-operations-application}"
IMAGE_TAG="${IMAGE_TAG:-pilot}"

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export AWS_PAGER=""

aws_cmd() {
  aws --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" "$@"
}

ensure_aws_session() {
  if aws_cmd sts get-caller-identity >/dev/null 2>&1; then
    return
  fi

  local login_lock="/tmp/dsp-deploy-admin-aws-login.lock"
  if ! mkdir "$login_lock" 2>/dev/null; then
    print -u2 "AWS authentication is already in progress for $AWS_PROFILE_NAME."
    print -u2 "Complete the existing browser prompt, then retry the deployment."
    exit 1
  fi

  print "AWS session is missing or expired."
  print "Opening one AWS login prompt for profile $AWS_PROFILE_NAME..."
  if ! aws login --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME"; then
    rmdir "$login_lock"
    print -u2 "AWS login failed."
    exit 1
  fi
  rmdir "$login_lock"

  if ! aws_cmd sts get-caller-identity >/dev/null 2>&1; then
    print -u2 "AWS login completed, but the deploy-admin identity could not be verified."
    exit 1
  fi
}

stack_output() {
  local stack_name="$1"
  local output_key="$2"
  aws_cmd cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text
}

wait_for_build() {
  local build_id="$1"
  local build_state="IN_PROGRESS"
  while [[ "$build_state" == "IN_PROGRESS" ]]; do
    sleep 5
    build_state="$(aws_cmd codebuild batch-get-builds --ids "$build_id" --query 'builds[0].buildStatus' --output text)"
    print "CodeBuild status: $build_state"
  done
  [[ "$build_state" == "SUCCEEDED" ]]
}

update_application_infrastructure() {
  local template_path="$PROJECT_ROOT/platform/infra/application.yaml"
  local raw_keys
  local update_output
  local update_rc
  local -a parameter_keys
  local -a parameter_args

  aws_cmd cloudformation validate-template --template-body "file://$template_path" >/dev/null
  raw_keys="$(aws_cmd cloudformation describe-stacks \
    --stack-name "$APPLICATION_STACK" \
    --query 'Stacks[0].Parameters[].ParameterKey' --output text)"
  parameter_keys=(${=raw_keys})
  parameter_args=()
  for key in "${parameter_keys[@]}"; do
    parameter_args+=("ParameterKey=$key,UsePreviousValue=true")
  done

  set +e
  update_output="$(aws_cmd cloudformation update-stack \
    --stack-name "$APPLICATION_STACK" \
    --template-body "file://$template_path" \
    --parameters "${parameter_args[@]}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --query StackId --output text 2>&1)"
  update_rc=$?
  set -e

  if (( update_rc == 0 )); then
    print "Updating application infrastructure..."
    aws_cmd cloudformation wait stack-update-complete --stack-name "$APPLICATION_STACK"
    return
  fi
  if [[ "$update_output" == *"No updates are to be performed"* ]]; then
    print "Application infrastructure is already current."
    return
  fi
  print -u2 "$update_output"
  return "$update_rc"
}

print "Verifying AWS identity..."
ensure_aws_session
aws_cmd sts get-caller-identity --query Arn --output text

print "Running tests..."
cd "$PROJECT_ROOT"
npm test

print "Refreshing packaged operational snapshots..."
python3 scripts/export_platform_snapshots.py

deployment_bucket="$(stack_output "$FOUNDATION_STACK" DeploymentBucketName)"
build_project="$(stack_output "$FOUNDATION_STACK" ImageBuildProjectName)"
repository_uri="$(stack_output "$FOUNDATION_STACK" ContainerRepositoryUri)"
cluster_name="$(stack_output "$FOUNDATION_STACK" EcsClusterName)"
service_name="$(stack_output "$APPLICATION_STACK" ApplicationServiceName)"
distribution_id="$(stack_output "$APPLICATION_STACK" DistributionId)"
website_url="$(stack_output "$APPLICATION_STACK" WebsiteUrl)"
public_subnet_a="$(stack_output "$FOUNDATION_STACK" PublicSubnetAId)"
public_subnet_b="$(stack_output "$FOUNDATION_STACK" PublicSubnetBId)"
application_security_group="$(stack_output "$FOUNDATION_STACK" ApplicationSecurityGroupId)"

for value in "$deployment_bucket" "$build_project" "$repository_uri" "$cluster_name" "$service_name" "$distribution_id" "$website_url" "$public_subnet_a" "$public_subnet_b" "$application_security_group"; do
  if [[ -z "$value" || "$value" == "None" ]]; then
    print -u2 "Required CloudFormation output is missing."
    exit 1
  fi
done

temp_root="$(mktemp -d /tmp/dsp-platform-deploy.XXXXXX)"
trap 'rm -rf -- "$temp_root"' EXIT
bundle_root="$temp_root/source"
mkdir -p "$bundle_root/data/dashboards"

cp "$PROJECT_ROOT/package.json" "$PROJECT_ROOT/package-lock.json" "$PROJECT_ROOT/.dockerignore" "$bundle_root/"
cp "$PROJECT_ROOT/AGENTS.md" "$PROJECT_ROOT/SOUL.md" "$PROJECT_ROOT/IDENTITY.md" "$bundle_root/"
rsync -a --exclude '.DS_Store' "$PROJECT_ROOT/platform/" "$bundle_root/platform/"
cp "$PROJECT_ROOT/data/dashboards/amazon-dsp-kpi-dashboard.html" "$bundle_root/data/dashboards/"

bundle_path="$temp_root/platform-source.zip"
(cd "$bundle_root" && zip -q -r "$bundle_path" .)
dashboard_sha="$(shasum -a 256 "$PROJECT_ROOT/data/dashboards/amazon-dsp-kpi-dashboard.html" | awk '{print $1}')"
print "Dashboard SHA-256: $dashboard_sha"

print "Uploading source bundle to s3://$deployment_bucket/source/platform-source.zip ..."
aws_cmd s3 cp "$bundle_path" "s3://$deployment_bucket/source/platform-source.zip" --only-show-errors

print "Starting remote image build..."
build_id="$(aws_cmd codebuild start-build \
  --project-name "$build_project" \
  --environment-variables-override \
    name=IMAGE_TAG,value="$IMAGE_TAG",type=PLAINTEXT \
  --query 'build.id' --output text)"
print "CodeBuild id: $build_id"
if ! wait_for_build "$build_id"; then
  log_url="$(aws_cmd codebuild batch-get-builds --ids "$build_id" --query 'builds[0].logs.deepLink' --output text)"
  print -u2 "CodeBuild failed: $log_url"
  exit 1
fi

expected_digest="$(aws_cmd ecr describe-images \
  --repository-name "${repository_uri##*/}" \
  --image-ids imageTag="$IMAGE_TAG" \
  --query 'imageDetails[0].imageDigest' --output text)"
print "Published image digest: $expected_digest"

update_application_infrastructure

bootstrap_task_definition="$(stack_output "$APPLICATION_STACK" BootstrapTaskDefinitionArn)"
print "Applying database migrations..."
bootstrap_task_arn="$(aws_cmd ecs run-task \
  --cluster "$cluster_name" \
  --task-definition "$bootstrap_task_definition" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$public_subnet_a,$public_subnet_b],securityGroups=[$application_security_group],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)"
if [[ -z "$bootstrap_task_arn" || "$bootstrap_task_arn" == "None" ]]; then
  print -u2 "Database bootstrap task failed to start."
  exit 1
fi
aws_cmd ecs wait tasks-stopped --cluster "$cluster_name" --tasks "$bootstrap_task_arn"
bootstrap_exit_code="$(aws_cmd ecs describe-tasks \
  --cluster "$cluster_name" \
  --tasks "$bootstrap_task_arn" \
  --query 'tasks[0].containers[?name==`bootstrap`].exitCode | [0]' --output text)"
if [[ "$bootstrap_exit_code" != "0" ]]; then
  bootstrap_reason="$(aws_cmd ecs describe-tasks \
    --cluster "$cluster_name" \
    --tasks "$bootstrap_task_arn" \
    --query 'tasks[0].{stoppedReason:stoppedReason,containerReason:containers[?name==`bootstrap`].reason | [0]}' --output json)"
  print -u2 "Database bootstrap failed: $bootstrap_reason"
  exit 1
fi
print "Database migrations are current."

print "Deploying ECS service..."
aws_cmd ecs update-service \
  --cluster "$cluster_name" \
  --service "$service_name" \
  --force-new-deployment >/dev/null
aws_cmd ecs wait services-stable --cluster "$cluster_name" --services "$service_name"

task_arn="$(aws_cmd ecs list-tasks --cluster "$cluster_name" --service-name "$service_name" --desired-status RUNNING --query 'taskArns[0]' --output text)"
running_digest="$(aws_cmd ecs describe-tasks --cluster "$cluster_name" --tasks "$task_arn" --query 'tasks[0].containers[0].imageDigest' --output text)"
if [[ "$running_digest" != "$expected_digest" ]]; then
  print -u2 "ECS digest mismatch: expected $expected_digest, running $running_digest"
  exit 1
fi

print "Invalidating CloudFront..."
invalidation_id="$(aws_cmd cloudfront create-invalidation \
  --distribution-id "$distribution_id" \
  --paths '/*' \
  --query 'Invalidation.Id' --output text)"
aws_cmd cloudfront wait invalidation-completed --distribution-id "$distribution_id" --id "$invalidation_id"

health_url="${website_url%/}/health"
http_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$health_url")"
if [[ "$http_status" != "200" ]]; then
  print -u2 "Health check failed: $health_url returned $http_status"
  exit 1
fi

print "Deployment complete: $website_url"
print "Dashboard SHA-256: $dashboard_sha"
print "Image digest: $running_digest"
