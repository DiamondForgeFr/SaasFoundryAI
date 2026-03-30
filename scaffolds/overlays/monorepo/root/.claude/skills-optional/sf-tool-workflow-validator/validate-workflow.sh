#!/bin/bash

# Workflow Validator for SaaSFoundry
# Validates .saasfoundry-workflow.json against remote project management tools

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration
CONFIG_FILE=".saasfoundry-workflow.json"
BACKUP_SUFFIX=".backup"
VERBOSE=false
AUTO_FIX=false
DRY_RUN=false
TOOL_FILTER=""

# Validation results
ISSUES_FOUND=0
WARNINGS_FOUND=0

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --fix)
      AUTO_FIX=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --tool|-t)
      TOOL_FILTER="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: validate-workflow.sh [options]"
      echo ""
      echo "Options:"
      echo "  --verbose, -v        Show detailed validation output"
      echo "  --fix                Auto-fix configuration mismatches"
      echo "  --dry-run            Preview fixes without applying them"
      echo "  --tool, -t <tool>    Validate specific tool only"
      echo "  --help, -h           Show this help message"
      echo ""
      echo "Supported tools: github-projects, jira, notion, linear"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Helper functions
log_info() {
  echo -e "${BLUE}$1${NC}"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
  ((WARNINGS_FOUND++))
}

log_error() {
  echo -e "${RED}❌ $1${NC}"
  ((ISSUES_FOUND++))
}

verbose_log() {
  if [ "$VERBOSE" = true ]; then
    echo -e "${NC}   $1${NC}"
  fi
}

# Load configuration file
load_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    log_error "Configuration file not found: $CONFIG_FILE"
    echo "Run 'sf new' or 'sf workflow' to create workflow configuration."
    exit 1
  fi

  verbose_log "Loading configuration from $CONFIG_FILE"

  # Export config values as environment variables
  TOOL=$(jq -r '.tool' "$CONFIG_FILE")
  PROJECT_URL=$(jq -r '.projectUrl // empty' "$CONFIG_FILE")

  if [ -z "$TOOL" ] || [ "$TOOL" = "null" ]; then
    log_error "Invalid configuration: 'tool' field missing"
    exit 1
  fi

  verbose_log "Tool: $TOOL"
  verbose_log "Project URL: $PROJECT_URL"
}

# Backup configuration before modifications
backup_config() {
  if [ "$DRY_RUN" = false ]; then
    cp "$CONFIG_FILE" "${CONFIG_FILE}${BACKUP_SUFFIX}"
    verbose_log "Created backup: ${CONFIG_FILE}${BACKUP_SUFFIX}"
  fi
}

# Update configuration file
update_config() {
  local field=$1
  local value=$2

  if [ "$DRY_RUN" = true ]; then
    log_info "[DRY RUN] Would update $field to: $value"
  else
    backup_config

    # Use jq to update the field
    local tmp_file="${CONFIG_FILE}.tmp"
    jq "$field = $value" "$CONFIG_FILE" > "$tmp_file"
    mv "$tmp_file" "$CONFIG_FILE"

    verbose_log "Updated $field in configuration"
  fi
}

# Validate GitHub Projects
validate_github_projects() {
  log_info "\n🔍 Validating GitHub Projects configuration..."

  # Check gh authentication
  if ! gh auth status &>/dev/null; then
    log_error "GitHub CLI not authenticated. Run: gh auth login"
    return 1
  fi

  log_success "GitHub CLI authenticated"

  # Parse project URL
  if [ -z "$PROJECT_URL" ]; then
    log_error "Project URL not configured"
    return 1
  fi

  verbose_log "Project URL: $PROJECT_URL"

  # Extract owner and project number from URL
  # Format: https://github.com/orgs/{owner}/projects/{number} or /users/{owner}/projects/{number}
  if [[ $PROJECT_URL =~ github\.com/(orgs|users)/([^/]+)/projects/([0-9]+) ]]; then
    local owner_type="${BASH_REMATCH[1]}"
    local owner="${BASH_REMATCH[2]}"
    local project_number="${BASH_REMATCH[3]}"

    verbose_log "Owner: $owner ($owner_type)"
    verbose_log "Project number: $project_number"

    # Query project using GraphQL
    local query
    if [ "$owner_type" = "orgs" ]; then
      query="query { organization(login: \"$owner\") { projectV2(number: $project_number) { id title fields(first: 20) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }"
    else
      query="query { user(login: \"$owner\") { projectV2(number: $project_number) { id title fields(first: 20) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }"
    fi

    local result
    if ! result=$(gh api graphql -f query="$query" 2>&1); then
      log_error "Failed to access GitHub Project: $result"
      return 1
    fi

    # Check if project exists
    local project_title
    if [ "$owner_type" = "orgs" ]; then
      project_title=$(echo "$result" | jq -r '.data.organization.projectV2.title // empty')
    else
      project_title=$(echo "$result" | jq -r '.data.user.projectV2.title // empty')
    fi

    if [ -z "$project_title" ]; then
      log_error "Project not found or not accessible"
      return 1
    fi

    log_success "Project accessible: $project_title"

    # Find Status field
    local status_field
    if [ "$owner_type" = "orgs" ]; then
      status_field=$(echo "$result" | jq -r '.data.organization.projectV2.fields.nodes[] | select(.name == "Status")')
    else
      status_field=$(echo "$result" | jq -r '.data.user.projectV2.fields.nodes[] | select(.name == "Status")')
    fi

    if [ -z "$status_field" ] || [ "$status_field" = "null" ]; then
      log_error "Status field not found in project"
      return 1
    fi

    log_success "Status field found"

    # Extract remote statuses
    local remote_statuses
    remote_statuses=$(echo "$status_field" | jq -r '.options[].name' | sort)

    verbose_log "Remote statuses:"
    echo "$remote_statuses" | while read -r status; do
      verbose_log "  - $status"
    done

    # Compare with local configuration
    local local_statuses
    local_statuses=$(jq -r '.statuses | to_entries[] | .value' "$CONFIG_FILE" | sort)

    verbose_log "Local statuses:"
    echo "$local_statuses" | while read -r status; do
      verbose_log "  - $status"
    done

    # Check for mismatches
    if [ "$remote_statuses" != "$local_statuses" ]; then
      log_warning "Status mismatch detected:"
      echo -e "   Local:  $(echo "$local_statuses" | tr '\n' ', ' | sed 's/,$//')"
      echo -e "   Remote: $(echo "$remote_statuses" | tr '\n' ', ' | sed 's/,$//')"

      if [ "$AUTO_FIX" = true ]; then
        log_info "🔧 Updating local configuration to match remote..."

        # Build new statuses object
        local new_statuses='{}'
        local keys=("backlog" "ready" "inProgress" "inReview" "done")
        local i=0

        echo "$remote_statuses" | while read -r status; do
          if [ $i -lt ${#keys[@]} ]; then
            new_statuses=$(echo "$new_statuses" | jq ". + {\"${keys[$i]}\": \"$status\"}")
            ((i++))
          fi
        done

        update_config '.statuses' "$new_statuses"
        log_success "Statuses updated"
      fi
    else
      log_success "Statuses match"
    fi

  else
    log_error "Invalid GitHub Project URL format"
    return 1
  fi

  return 0
}

# Validate Jira
validate_jira() {
  log_info "\n🔍 Validating Jira configuration..."

  # Check credentials
  local credentials_dir="$HOME/.claude/credentials/jira"
  if [ ! -d "$credentials_dir" ]; then
    log_error "No Jira credentials found. Run: sf tools add jira <account>"
    return 1
  fi

  local env_files=("$credentials_dir"/*.env)
  if [ ! -f "${env_files[0]}" ]; then
    log_error "No Jira credentials found"
    return 1
  fi

  # Load first available credential file
  source "${env_files[0]}"

  if [ -z "$JIRA_EMAIL" ] || [ -z "$JIRA_API_TOKEN" ] || [ -z "$JIRA_DOMAIN" ]; then
    log_error "Invalid Jira credentials (missing JIRA_EMAIL, JIRA_API_TOKEN, or JIRA_DOMAIN)"
    return 1
  fi

  log_success "Jira credentials loaded"

  # Parse project key from URL
  if [[ $PROJECT_URL =~ atlassian\.net/browse/([A-Z]+) ]]; then
    local project_key="${BASH_REMATCH[1]}"
    verbose_log "Project key: $project_key"

    # Test API connection and get project info
    local auth_header="Authorization: Basic $(echo -n "$JIRA_EMAIL:$JIRA_API_TOKEN" | base64)"
    local result

    if ! result=$(curl -s -H "$auth_header" "https://$JIRA_DOMAIN/rest/api/3/project/$project_key" 2>&1); then
      log_error "Failed to connect to Jira API"
      return 1
    fi

    local project_name
    project_name=$(echo "$result" | jq -r '.name // empty')

    if [ -z "$project_name" ]; then
      log_error "Project not found or not accessible"
      return 1
    fi

    log_success "Project accessible: $project_name"

    # Get workflow statuses
    if ! result=$(curl -s -H "$auth_header" "https://$JIRA_DOMAIN/rest/api/3/status" 2>&1); then
      log_error "Failed to fetch Jira statuses"
      return 1
    fi

    local remote_statuses
    remote_statuses=$(echo "$result" | jq -r '.[].name' | sort)

    verbose_log "Available Jira statuses:"
    echo "$remote_statuses" | while read -r status; do
      verbose_log "  - $status"
    done

    log_success "Jira validation complete"

  else
    log_error "Invalid Jira URL format"
    return 1
  fi

  return 0
}

# Validate Notion
validate_notion() {
  log_info "\n🔍 Validating Notion configuration..."

  # Check credentials
  local credentials_dir="$HOME/.claude/credentials/notion"
  if [ ! -d "$credentials_dir" ]; then
    log_error "No Notion credentials found. Run: sf tools add notion <account>"
    return 1
  fi

  local env_files=("$credentials_dir"/*.env)
  if [ ! -f "${env_files[0]}" ]; then
    log_error "No Notion credentials found"
    return 1
  fi

  # Load first available credential file
  source "${env_files[0]}"

  if [ -z "$NOTION_API_KEY" ]; then
    log_error "Invalid Notion credentials (missing NOTION_API_KEY)"
    return 1
  fi

  log_success "Notion credentials loaded"

  # Extract database ID from URL
  # Format: https://notion.so/workspace/DatabaseName-{32-char-id}
  local db_id
  if [[ $PROJECT_URL =~ ([a-f0-9]{32})|([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}) ]]; then
    db_id="${BASH_REMATCH[0]}"
    # Convert to UUID format if needed
    if [[ ! $db_id =~ - ]]; then
      db_id="${db_id:0:8}-${db_id:8:4}-${db_id:12:4}-${db_id:16:4}-${db_id:20:12}"
    fi

    verbose_log "Database ID: $db_id"

    # Query database
    local result
    if ! result=$(curl -s -X GET "https://api.notion.com/v1/databases/$db_id" \
      -H "Authorization: Bearer $NOTION_API_KEY" \
      -H "Notion-Version: 2022-06-28" 2>&1); then
      log_error "Failed to access Notion database"
      return 1
    fi

    local db_title
    db_title=$(echo "$result" | jq -r '.title[0].plain_text // empty')

    if [ -z "$db_title" ]; then
      log_error "Database not found or not accessible"
      return 1
    fi

    log_success "Database accessible: $db_title"

    # Check for Status property
    local status_prop
    status_prop=$(echo "$result" | jq -r '.properties.Status // empty')

    if [ -z "$status_prop" ] || [ "$status_prop" = "null" ]; then
      log_warning "Status property not found in database"
    else
      log_success "Status property found"

      # Extract status options
      local remote_statuses
      remote_statuses=$(echo "$status_prop" | jq -r '.select.options[].name' | sort)

      verbose_log "Remote statuses:"
      echo "$remote_statuses" | while read -r status; do
        verbose_log "  - $status"
      done
    fi

  else
    log_error "Invalid Notion URL format"
    return 1
  fi

  return 0
}

# Validate Linear
validate_linear() {
  log_info "\n🔍 Validating Linear configuration..."

  # Check credentials
  local credentials_dir="$HOME/.claude/credentials/linear"
  if [ ! -d "$credentials_dir" ]; then
    log_error "No Linear credentials found. Run: sf tools add linear <account>"
    return 1
  fi

  local env_files=("$credentials_dir"/*.env)
  if [ ! -f "${env_files[0]}" ]; then
    log_error "No Linear credentials found"
    return 1
  fi

  # Load first available credential file
  source "${env_files[0]}"

  if [ -z "$LINEAR_API_KEY" ]; then
    log_error "Invalid Linear credentials (missing LINEAR_API_KEY)"
    return 1
  fi

  log_success "Linear credentials loaded"

  # Parse team key from URL (format: linear://{team-key})
  if [[ $PROJECT_URL =~ linear://([A-Z]+) ]]; then
    local team_key="${BASH_REMATCH[1]}"
    verbose_log "Team key: $team_key"

    # Query Linear API for team and workflow states
    local query='{ teams { nodes { key name states { nodes { name type } } } } }'
    local result

    if ! result=$(curl -s -X POST https://api.linear.app/graphql \
      -H "Authorization: $LINEAR_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"query\": \"$query\"}" 2>&1); then
      log_error "Failed to connect to Linear API"
      return 1
    fi

    # Find team by key
    local team
    team=$(echo "$result" | jq -r ".data.teams.nodes[] | select(.key == \"$team_key\")")

    if [ -z "$team" ] || [ "$team" = "null" ]; then
      log_error "Team not found: $team_key"
      return 1
    fi

    local team_name
    team_name=$(echo "$team" | jq -r '.name')
    log_success "Team accessible: $team_name"

    # Extract workflow states
    local remote_statuses
    remote_statuses=$(echo "$team" | jq -r '.states.nodes[].name' | sort)

    verbose_log "Remote statuses:"
    echo "$remote_statuses" | while read -r status; do
      verbose_log "  - $status"
    done

    log_success "Linear validation complete"

  else
    log_error "Invalid Linear URL format (expected: linear://{TEAM})"
    return 1
  fi

  return 0
}

# Main validation logic
main() {
  log_info "🔍 Validating workflow configuration..."
  echo ""

  # Load configuration
  load_config

  # Skip validation if tool is 'none'
  if [ "$TOOL" = "none" ]; then
    log_info "Tool is set to 'none' - no validation needed"
    exit 0
  fi

  # Validate specific tool or current tool
  if [ -n "$TOOL_FILTER" ] && [ "$TOOL_FILTER" != "$TOOL" ]; then
    log_info "Skipping validation - tool filter '$TOOL_FILTER' does not match configured tool '$TOOL'"
    exit 0
  fi

  # Run tool-specific validation
  case $TOOL in
    github-projects)
      validate_github_projects
      ;;
    jira)
      validate_jira
      ;;
    notion)
      validate_notion
      ;;
    linear)
      validate_linear
      ;;
    *)
      log_error "Unknown tool: $TOOL"
      exit 1
      ;;
  esac

  # Update validation timestamp if successful
  if [ $ISSUES_FOUND -eq 0 ]; then
    if [ "$AUTO_FIX" = false ]; then
      log_info "\n🎉 Validation successful!"

      # Update validated flag and timestamp
      update_config '.validated' 'true'
      update_config '.lastValidated' "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
    fi
  else
    echo ""
    log_error "Validation failed with $ISSUES_FOUND issue(s)"

    if [ "$AUTO_FIX" = false ]; then
      echo ""
      log_info "Run with --fix to update local configuration automatically"
    fi

    exit 1
  fi

  if [ $WARNINGS_FOUND -gt 0 ]; then
    echo ""
    log_warning "Validation completed with $WARNINGS_FOUND warning(s)"
  fi
}

# Run main function
main
