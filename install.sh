#!/data/data/com.termux/files/usr/bin/bash
# ─────────────────────────────────────────────
#  ZerathCode v1 — Termux Install Script
#  Multi-Agent AI Dev System
#  Run: bash install.sh
# ─────────────────────────────────────────────

set -e

C_CYAN='\033[0;36m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[1;33m'
C_RED='\033[0;31m'
C_BOLD='\033[1m'
C_RESET='\033[0m'
C_MAGENTA='\033[0;35m'

step()  { echo -e "${C_CYAN}${C_BOLD}▶ $1${C_RESET}"; }
ok()    { echo -e "${C_GREEN}✔  $1${C_RESET}"; }
warn()  { echo -e "${C_YELLOW}⚠  $1${C_RESET}"; }
fail()  { echo -e "${C_RED}✖  $1${C_RESET}"; }

echo ""
echo -e "${C_MAGENTA}${C_BOLD}  ╔══════════════════════════════════════════════╗${C_RESET}"
echo -e "${C_MAGENTA}${C_BOLD}  ║   ZerathCode v1 — Termux Installer           ║${C_RESET}"
echo -e "${C_MAGENTA}${C_BOLD}  ║   Multi-Agent AI Dev System                   ║${C_RESET}"
echo -e "${C_MAGENTA}${C_BOLD}  ╚══════════════════════════════════════════════╝${C_RESET}"
echo ""

# ── Step 1: Update Termux packages ───────────────────────────────────────────
step "Updating Termux packages..."
pkg update -y -o Dpkg::Options::="--force-confold" 2>/dev/null || warn "pkg update had warnings"
ok "Packages updated"

# ── Step 2: Core packages ─────────────────────────────────────────────────────
step "Installing core packages (nodejs, openjdk-17, git)..."
pkg install -y nodejs openjdk-17 git wget unzip 2>/dev/null
ok "Core packages installed"

# ── Step 3: Optional packages ─────────────────────────────────────────────────
step "Installing optional packages..."
pkg install -y termux-api cloudflared nginx android-tools 2>/dev/null || \
  warn "Some optional packages unavailable — install manually if needed"
ok "Optional packages done"

# ── Step 4: Storage permission ────────────────────────────────────────────────
step "Setting up storage access..."
if [ ! -d "$HOME/storage" ]; then
  termux-setup-storage 2>/dev/null || warn "Run 'termux-setup-storage' manually for /sdcard access"
fi

# ── Step 5: Install ZerathCode ────────────────────────────────────────────────
INSTALL_DIR="$HOME/zerathcode"
step "Installing ZerathCode to $INSTALL_DIR..."

if [ -d "$INSTALL_DIR" ]; then
  warn "Directory exists — pulling latest..."
  cd "$INSTALL_DIR" && git pull 2>/dev/null || true
else
  # Try git clone; if repo not public yet, assume files are local
  git clone https://github.com/zerathcode/zerathcode.git "$INSTALL_DIR" 2>/dev/null || {
    warn "Could not clone — assuming files are in current directory"
    INSTALL_DIR="$(pwd)"
  }
fi

# ── Step 6: Link zerath command ───────────────────────────────────────────────
step "Linking 'zerath' command..."
mkdir -p "$HOME/bin"
chmod +x "$INSTALL_DIR/bin/zerathcode.js" 2>/dev/null || true
ln -sf "$INSTALL_DIR/bin/zerathcode.js" "$HOME/bin/zerath" 2>/dev/null || true

# Add ~/bin to PATH
if ! grep -q 'HOME/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH=$PATH:$HOME/bin' >> "$HOME/.bashrc"
fi
if ! grep -q 'HOME/bin' "$HOME/.profile" 2>/dev/null; then
  echo 'export PATH=$PATH:$HOME/bin' >> "$HOME/.profile"
fi

ok "'zerath' command linked"

# ── Step 7: Create workspace ──────────────────────────────────────────────────
mkdir -p "$HOME/hex-workspace"
mkdir -p "$HOME/.zerathcode"
ok "Workspace ready: ~/hex-workspace"

# ── Step 8: Android SDK hint ──────────────────────────────────────────────────
echo ""
echo -e "${C_YELLOW}${C_BOLD}  Android SDK (for APK builds — optional):${C_RESET}"
echo ""
echo -e "  ${C_CYAN}mkdir -p \$HOME/android-sdk/cmdline-tools${C_RESET}"
echo -e "  ${C_CYAN}cd \$HOME/android-sdk/cmdline-tools${C_RESET}"
echo -e "  ${C_CYAN}wget https://dl.google.com/android/repository/commandlinetools-linux-10406996_latest.zip${C_RESET}"
echo -e "  ${C_CYAN}unzip commandlinetools-linux-*.zip && mv cmdline-tools latest${C_RESET}"
echo -e "  ${C_CYAN}yes | \$HOME/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses${C_RESET}"
echo -e "  ${C_CYAN}\$HOME/android-sdk/cmdline-tools/latest/bin/sdkmanager 'build-tools;34.0.0' 'platforms;android-34'${C_RESET}"
echo -e "  ${C_CYAN}echo 'export ANDROID_SDK_ROOT=\$HOME/android-sdk' >> ~/.bashrc${C_RESET}"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C_GREEN}${C_BOLD}╔══════════════════════════════════════════════╗${C_RESET}"
echo -e "${C_GREEN}${C_BOLD}║   ZerathCode v1 installed! 🚀                 ║${C_RESET}"
echo -e "${C_GREEN}${C_BOLD}╚══════════════════════════════════════════════╝${C_RESET}"
echo ""
echo "  Reload shell and run:"
echo ""
echo -e "  ${C_CYAN}source ~/.bashrc${C_RESET}"
echo ""
echo -e "  ${C_CYAN}zerath keys add claude   sk-ant-api03-...${C_RESET}   # Add API key"
echo -e "  ${C_CYAN}zerath keys add gemini   AIzaSy-...${C_RESET}"
echo -e "  ${C_CYAN}zerath keys add gpt      sk-proj-...${C_RESET}"
echo ""
echo -e "  ${C_CYAN}zerath run${C_RESET}                                  # Launch interactive REPL"
echo -e "  ${C_CYAN}zerath android init MyApp${C_RESET}                   # Build Android APK directly"
echo -e "  ${C_CYAN}zerath infra deploy --port 3000${C_RESET}             # Deploy + Cloudflare tunnel"
echo -e "  ${C_CYAN}zerath security scan${C_RESET}                        # Scan for secrets"
echo -e "  ${C_CYAN}zerath monitor${C_RESET}                              # Battery + temperature"
echo ""
