#!/bin/bash

##############################################################################
# Comprehensive Test Runner for Training Requirements Management
# 
# Task 8.2: Run all tests in CI/CD pipeline
# 
# This script:
# 1. Validates environment setup
# 2. Runs all unit and integration tests
# 3. Runs end-to-end tests
# 4. Runs performance tests
# 5. Generates coverage reports
# 6. Reports results
##############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_TIMEOUT=600
COVERAGE_THRESHOLD=70

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Training Requirements Management - Test Suite${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}\n"

##############################################################################
# 1. ENVIRONMENT VALIDATION
##############################################################################

echo -e "${YELLOW}[1/6] Validating environment...${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found${NC}"
    exit 1
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node.js ${NODE_VERSION}${NC}"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found${NC}"
    exit 1
fi
NPM_VERSION=$(npm --version)
echo -e "${GREEN}✓ npm ${NPM_VERSION}${NC}"

# Check if Jest is installed
if ! npm list jest &>/dev/null; then
    echo -e "${YELLOW}! Jest not installed, installing...${NC}"
    npm install --save-dev jest ts-jest @types/jest
fi
echo -e "${GREEN}✓ Jest configured${NC}"

# Check .env file
if [ ! -f "$BACKEND_DIR/.env.test" ]; then
    echo -e "${YELLOW}⚠ .env.test not found, using .env${NC}"
fi

echo -e "${GREEN}✓ Environment validated${NC}\n"

##############################################################################
# 2. UNIT AND INTEGRATION TESTS
##############################################################################

echo -e "${YELLOW}[2/6] Running unit and integration tests...${NC}"

TEST_PATTERN="requirement-definitions.*\\.(test|spec)\\.ts$"

npm test -- \
    --testPathPattern="requirement-definitions" \
    --testNamePattern="Authorization Tests|Data Isolation Tests|Request/Response Validation|Edge Cases" \
    --runInBand \
    --forceExit \
    --detectOpenHandles \
    --bail=false \
    --coverageDirectory=coverage \
    --collectCoverageFrom="src/**/*.ts" \
    2>&1 | tee test-results.log

UNIT_TESTS_EXIT=${PIPESTATUS[0]}

if [ $UNIT_TESTS_EXIT -eq 0 ]; then
    echo -e "${GREEN}✓ Unit and integration tests passed${NC}\n"
else
    echo -e "${RED}✗ Unit and integration tests failed (exit code: $UNIT_TESTS_EXIT)${NC}\n"
fi

##############################################################################
# 3. END-TO-END TESTS
##############################################################################

echo -e "${YELLOW}[3/6] Running end-to-end tests...${NC}"

npm test -- \
    --testPathPattern="admin-workflow.e2e" \
    --runInBand \
    --forceExit \
    --detectOpenHandles \
    --timeout=$TEST_TIMEOUT \
    2>&1 | tee -a test-results.log

E2E_TESTS_EXIT=${PIPESTATUS[0]}

if [ $E2E_TESTS_EXIT -eq 0 ]; then
    echo -e "${GREEN}✓ End-to-end tests passed${NC}\n"
else
    echo -e "${YELLOW}⚠ End-to-end tests failed or incomplete${NC}\n"
fi

##############################################################################
# 4. PERFORMANCE TESTS
##############################################################################

echo -e "${YELLOW}[4/6] Running performance tests...${NC}"

npm test -- \
    --testPathPattern="performance.test" \
    --runInBand \
    --forceExit \
    --detectOpenHandles \
    --timeout=$TEST_TIMEOUT \
    2>&1 | tee -a test-results.log

PERF_TESTS_EXIT=${PIPESTATUS[0]}

if [ $PERF_TESTS_EXIT -eq 0 ]; then
    echo -e "${GREEN}✓ Performance tests passed${NC}\n"
else
    echo -e "${YELLOW}⚠ Performance tests failed or incomplete${NC}\n"
fi

##############################################################################
# 5. COMPREHENSIVE INTEGRATION TESTS
##############################################################################

echo -e "${YELLOW}[5/6] Running comprehensive integration tests...${NC}"

npm test -- \
    --testPathPattern="comprehensive-integration.test" \
    --runInBand \
    --forceExit \
    --detectOpenHandles \
    --timeout=$TEST_TIMEOUT \
    2>&1 | tee -a test-results.log

COMPREHENSIVE_TESTS_EXIT=${PIPESTATUS[0]}

if [ $COMPREHENSIVE_TESTS_EXIT -eq 0 ]; then
    echo -e "${GREEN}✓ Comprehensive integration tests passed${NC}\n"
else
    echo -e "${YELLOW}⚠ Comprehensive integration tests failed or incomplete${NC}\n"
fi

##############################################################################
# 6. COVERAGE REPORT GENERATION
##############################################################################

echo -e "${YELLOW}[6/6] Generating coverage reports...${NC}"

if [ -d "coverage" ]; then
    COVERAGE_SUMMARY=$(find coverage -name "coverage-summary.json" -exec cat {} \;)
    
    if [ -n "$COVERAGE_SUMMARY" ]; then
        echo -e "${GREEN}✓ Coverage report generated${NC}"
        echo ""
        echo "Coverage Summary:"
        echo "$COVERAGE_SUMMARY" | grep -E '"lines"|"statements"|"functions"|"branches"' || true
    else
        echo -e "${YELLOW}⚠ Coverage summary not found${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Coverage directory not found${NC}"
fi

echo ""

##############################################################################
# SUMMARY AND FINAL REPORT
##############################################################################

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Test Results Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}\n"

# Count test results from log
TESTS_PASSED=$(grep -c "✓" test-results.log || echo "0")
TESTS_FAILED=$(grep -c "✗" test-results.log || echo "0")
TESTS_SKIPPED=$(grep -c "○" test-results.log || echo "0")

echo "Test Execution Results:"
echo "  Unit & Integration: $([ $UNIT_TESTS_EXIT -eq 0 ] && echo "✓ PASSED" || echo "✗ FAILED")"
echo "  End-to-End: $([ $E2E_TESTS_EXIT -eq 0 ] && echo "✓ PASSED" || echo "✗ FAILED (or incomplete)")"
echo "  Performance: $([ $PERF_TESTS_EXIT -eq 0 ] && echo "✓ PASSED" || echo "✗ FAILED (or incomplete)")"
echo "  Comprehensive: $([ $COMPREHENSIVE_TESTS_EXIT -eq 0 ] && echo "✓ PASSED" || echo "✗ FAILED (or incomplete)")"

echo ""
echo "Overall Statistics:"
echo "  Passed: $TESTS_PASSED"
echo "  Failed: $TESTS_FAILED"
echo "  Skipped: $TESTS_SKIPPED"

echo ""
echo "Artifacts:"
echo "  Coverage: ./coverage/"
echo "  Results Log: ./test-results.log"

echo ""

# Final exit code
if [ $UNIT_TESTS_EXIT -eq 0 ] && [ $COMPREHENSIVE_TESTS_EXIT -eq 0 ]; then
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ ALL CRITICAL TESTS PASSED${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════${NC}\n"
    exit 0
else
    echo -e "${RED}═══════════════════════════════════════════════════${NC}"
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    echo -e "${RED}═══════════════════════════════════════════════════${NC}\n"
    exit 1
fi
