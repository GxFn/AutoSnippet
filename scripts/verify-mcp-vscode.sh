#!/bin/bash

# MCP × VSCode Copilot 集成验证脚本
# 用途: 快速验证 MCP 和 Skills 配置是否正确
# 使用: bash scripts/verify-mcp-vscode.sh

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  MCP × VSCode Copilot 集成验证                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
echo ""

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

PASS=0
FAIL=0
WARN=0

# 帮助函数
check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASS++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAIL++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARN++))
}

# ============ 1. Node.js 检查 ============
echo -e "${BLUE}[1] 环境检查${NC}"
echo ""

if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    check_pass "Node.js 已安装: $NODE_VERSION"
else
    check_fail "Node.js 未安装"
fi

if [ -f "bin/asd" ]; then
    check_pass "asd 可执行文件存在"
    if ./bin/asd --help > /dev/null 2>&1; then
        check_pass "asd 命令可执行"
    else
        check_warn "asd 命令可能需要依赖配置"
    fi
else
    check_fail "asd 可执行文件不存在 (请运行: npm install)"
fi

echo ""

# ============ 2. MCP Server 检查 ============
echo -e "${BLUE}[2] MCP Server 检查${NC}"
echo ""

MCP_SERVER_PATH="scripts/mcp-server.js"
if [ -f "$MCP_SERVER_PATH" ]; then
    check_pass "MCP Server 文件存在: $MCP_SERVER_PATH"
    
    # 检查注册的工具数量
    TOOL_COUNT=$(grep -c "registerTool(" "$MCP_SERVER_PATH" || echo "0")
    if [ "$TOOL_COUNT" -gt 0 ]; then
        check_pass "已注册 $TOOL_COUNT 个 MCP 工具"
    else
        check_fail "未发现注册的 MCP 工具"
    fi
else
    check_fail "MCP Server 文件不存在"
fi

echo ""

# ============ 3. Skills 检查 ============
echo -e "${BLUE}[3] Skills 检查${NC}"
echo ""

SKILLS_DIR="skills"
if [ -d "$SKILLS_DIR" ]; then
    SKILL_COUNT=$(find "$SKILLS_DIR" -type f -name "SKILL.md" | wc -l)
    if [ "$SKILL_COUNT" -eq 8 ]; then
        check_pass "所有 8 个 Skills 已定义"
        
        # 列出 Skills
        echo "   已定义的 Skills:"
        for skill in "$SKILLS_DIR"/*/; do
            SKILL_NAME=$(basename "$skill")
            if [ -f "$skill/SKILL.md" ]; then
                echo "   - $SKILL_NAME"
            fi
        done
    else
        check_warn "只找到 $SKILL_COUNT 个 Skills (期望 8 个)"
    fi
else
    check_fail "Skills 目录不存在"
fi

echo ""

# ============ 4. VSCode 配置检查 ============
echo -e "${BLUE}[4] VSCode 配置检查${NC}"
echo ""

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    VSCODE_SETTINGS="$HOME/Library/Application Support/Code/User/settings.json"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    VSCODE_SETTINGS="$HOME/.config/Code/User/settings.json"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    # Windows
    VSCODE_SETTINGS="$APPDATA/Code/User/settings.json"
else
    VSCODE_SETTINGS="unknown"
fi

if [ -f "$VSCODE_SETTINGS" ]; then
    check_pass "VSCode settings.json 文件存在"
    
    # 检查 MCP 配置
    if grep -q "github.copilot.mcp" "$VSCODE_SETTINGS"; then
        check_pass "MCP 配置已添加到 settings.json"
        
        # 检查 autosnippet 服务器
        if grep -q '"name".*"autosnippet"' "$VSCODE_SETTINGS"; then
            check_pass "autosnippet MCP Server 已配置"
        else
            check_warn "autosnippet MCP Server 未在 settings.json 中找到"
        fi
    else
        check_warn "MCP 配置未在 settings.json 中找到"
        check_warn "请运行: node scripts/setup-mcp-config.js --editor vscode"
    fi
else
    check_warn "VSCode settings.json 文件未找到"
    check_warn "可能还未启动 VSCode，或在其他位置"
    check_warn "预期路径: $VSCODE_SETTINGS"
fi

echo ""

# ============ 5. Dashboard 检查 ============
echo -e "${BLUE}[5] Dashboard 状态检查${NC}"
echo ""

DASHBOARD_PORT=3000
DASHBOARD_URL="http://localhost:$DASHBOARD_PORT"

if command -v curl &> /dev/null; then
    if timeout 3 curl -s "$DASHBOARD_URL" > /dev/null 2>&1; then
        check_pass "Dashboard 正在运行: $DASHBOARD_URL"
    else
        check_warn "Dashboard 未运行"
        check_warn "请执行: asd ui"
    fi
else
    check_warn "curl 不可用，无法检查 Dashboard 状态"
fi

echo ""

# ============ 6. CLI 命令检查 ============
echo -e "${BLUE}[6] CLI 命令检查${NC}"
echo ""

# 检查 asd 帮助 - 尝试多种方式
ASD_CMD=""
if command -v asd &> /dev/null; then
    ASD_CMD="asd"
elif [ -f "bin/asd" ]; then
    ASD_CMD="./bin/asd"
fi

if [ -n "$ASD_CMD" ]; then
    if $ASD_CMD --help > /dev/null 2>&1; then
        check_pass "asd 命令可用"
    else
        check_warn "asd 命令存在但可能需要依赖初始化"
    fi
    
    # 列出支持的命令
    echo "   支持的主要命令:"
    echo "   - asd search <关键词>       (知识库搜索)"
    echo "   - asd ss <关键词>           (智能搜索)"
    echo "   - asd create                (创建 Recipe)"
    echo "   - asd ui                    (启动 Dashboard)"
    echo "   - asd batch-scan <dir>      (批量扫描)"
else
    check_warn "asd 命令不可用 (可以用 npm install -g . 全局安装)"
fi

echo ""

# ============ 7. 文档完整性检查 ============
echo -e "${BLUE}[7] 文档完整性检查${NC}"
echo ""

DOCS=(
    "README_VSCODE_INTEGRATION.md"
    "QUICK_MCP_SETUP.md"
    "VSCode_Copilot_集成清单.md"
    "scripts/setup-mcp-config.js"
)

for doc in "${DOCS[@]}"; do
    if [ -f "$doc" ]; then
        check_pass "文档已存在: $doc"
    else
        check_fail "文档缺失: $doc"
    fi
done

echo ""

# ============ 8. 快速功能测试 ============
echo -e "${BLUE}[8] 快速功能测试${NC}"
echo ""

# 检查 asd 命令行
if [ -f "bin/asd-cli.js" ]; then
    check_pass "CLI 入口文件存在: bin/asd-cli.js"
else
    check_fail "CLI 入口文件不存在: bin/asd-cli.js"
fi

if [ -f "bin/asd" ]; then
    check_pass "asd 可执行文件存在"
fi

echo ""

# ============ 总结 ============
echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  验证总结                                          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "通过: ${GREEN}$PASS${NC}"
echo -e "失败: ${RED}$FAIL${NC}"
echo -e "警告: ${YELLOW}$WARN${NC}"
echo ""

# 计算完成度
TOTAL=$((PASS + FAIL + WARN))
if [ $TOTAL -gt 0 ]; then
    COMPLETION=$((PASS * 100 / TOTAL))
    echo -e "完成度: ${GREEN}${COMPLETION}%${NC}"
else
    COMPLETION=0
fi

echo ""

# 给出建议
if [ $FAIL -eq 0 ] && [ $WARN -eq 0 ]; then
    echo -e "${GREEN}✓ 所有检查都已通过！${NC}"
    echo ""
    echo "立即使用:"
    echo "  1. 启动 Dashboard: asd ui"
    echo "  2. 重启 VSCode: code -r"
    echo "  3. 在 Copilot Chat 中使用 @autosnippet"
elif [ $FAIL -eq 0 ]; then
    echo -e "${YELLOW}⚠ 有 $WARN 个警告，但无严重错误${NC}"
    echo ""
    echo "建议操作:"
    echo "  1. 启动 Dashboard: asd ui"
    echo "  2. 重启 VSCode"
    echo "  3. (可选) 运行自动配置: node scripts/setup-mcp-config.js --editor vscode"
else
    echo -e "${RED}✗ 有 $FAIL 个错误需要修复${NC}"
    echo ""
    echo "错误修复步骤:"
    echo "  1. 检查 Node.js 是否安装"
    echo "  2. 检查项目文件是否完整"
    echo "  3. 运行: npm install && npm run build"
fi

echo ""

# 退出码
if [ $FAIL -eq 0 ]; then
    exit 0
else
    exit 1
fi
