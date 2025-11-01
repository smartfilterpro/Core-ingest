#!/bin/bash

# Summary Health Check Script
# This script validates summary data completeness and can automatically backfill missing data

set -e

# Configuration
API_URL="${API_URL:-http://localhost:8080}"
DAYS="${DAYS:-30}"
AUTO_FIX="${AUTO_FIX:-false}"
COVERAGE_THRESHOLD="${COVERAGE_THRESHOLD:-95}"

echo "🔍 Checking summary health..."
echo "   API URL: $API_URL"
echo "   Days: $DAYS"
echo "   Auto-fix: $AUTO_FIX"
echo ""

# Check if API is reachable
if ! curl -s -f "$API_URL/health" > /dev/null; then
  echo "❌ API is not reachable at $API_URL"
  exit 1
fi

# Get validation data
VALIDATION=$(curl -s "$API_URL/summaries/validate?days=$DAYS")

# Check if request was successful
if [ "$(echo "$VALIDATION" | jq -r '.ok')" != "true" ]; then
  echo "❌ Validation request failed"
  echo "$VALIDATION" | jq .
  exit 1
fi

# Extract key metrics
COVERAGE=$(echo "$VALIDATION" | jq -r '.validation.health.coverage_percent')
GAP_COUNT=$(echo "$VALIDATION" | jq -r '.validation.health.date_gaps_count')
SOURCE_DATES=$(echo "$VALIDATION" | jq -r '.validation.health.source_data_dates')
SUMMARY_DATES=$(echo "$VALIDATION" | jq -r '.validation.health.summary_dates')
LAST_UPDATED=$(echo "$VALIDATION" | jq -r '.validation.statistics.last_updated')

echo "📊 Summary Health Report"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Coverage:          ${COVERAGE}%"
echo "Date gaps:         $GAP_COUNT"
echo "Source dates:      $SOURCE_DATES"
echo "Summary dates:     $SUMMARY_DATES"
echo "Last updated:      $LAST_UPDATED"
echo ""

# Check coverage threshold
if [ "$COVERAGE" -lt "$COVERAGE_THRESHOLD" ]; then
  echo "⚠️  WARNING: Coverage is below threshold (${COVERAGE}% < ${COVERAGE_THRESHOLD}%)"

  # Show gaps
  if [ "$GAP_COUNT" -gt 0 ]; then
    echo ""
    echo "📅 Missing dates (first 10):"
    echo "$VALIDATION" | jq -r '.validation.date_gaps[:10][] | "   - \(.date) (\(.device_name // "Unknown"))"'
  fi

  # Auto-fix if enabled
  if [ "$AUTO_FIX" = "true" ]; then
    echo ""
    echo "🔧 Auto-fix enabled. Running backfill..."

    # Run summary worker with extended lookback
    BACKFILL_RESULT=$(curl -s "$API_URL/workers/run-all")

    if [ "$(echo "$BACKFILL_RESULT" | jq -r '.ok // false')" = "true" ]; then
      echo "✅ Backfill completed successfully"

      # Re-check coverage
      sleep 5
      NEW_VALIDATION=$(curl -s "$API_URL/summaries/validate?days=$DAYS")
      NEW_COVERAGE=$(echo "$NEW_VALIDATION" | jq -r '.validation.health.coverage_percent')

      echo "   New coverage: ${NEW_COVERAGE}%"

      if [ "$NEW_COVERAGE" -ge "$COVERAGE_THRESHOLD" ]; then
        echo "✅ Coverage is now above threshold!"
        exit 0
      else
        echo "⚠️  Coverage improved but still below threshold"
        exit 1
      fi
    else
      echo "❌ Backfill failed"
      echo "$BACKFILL_RESULT" | jq .
      exit 1
    fi
  else
    echo ""
    echo "💡 To fix this, run:"
    echo "   AUTO_FIX=true $0"
    echo "   or manually: curl $API_URL/workers/run-all"
    exit 1
  fi
else
  echo "✅ Summary health is good (${COVERAGE}% coverage)"
  exit 0
fi
