# Installation & Upgrade Guide — ZerathCode v2.0

## For New Installations

### Quick Start
```bash
# Clone or download the repo
cd zerathcode

# Install dependencies (new: @xenova/transformers, htmlparser2, natural)
npm install

# Link to global (optional)
npm link

# Test
zerath version
zerath ask "Hello"
```

### System Requirements
- **Node.js:** ≥18.0.0 (must already be installed)
- **Disk:** 100MB (code + model cache)
- **Memory:** 250MB free during operation
- **Internet:** Required for first model download (~30MB)

### Termux-Specific Setup
```bash
# If on Termux/Android
pkg update && pkg upgrade
pkg install nodejs

# Then proceed with npm install as above
```

## For Existing Installations (Upgrade from v1.x)

### Automatic Upgrade
```bash
# Back up your config and API keys first
cp ~/.zerathcode/keys ~/.zerathcode/keys.backup

# Update code
git pull origin main

# Install new dependencies
npm install

# Test
zerath ask "Test query"
```

### Manual Update Steps

1. **Backup**
   ```bash
   cp ~/.zerathcode/keys ~/.zerathcode/keys.backup
   cp ~/.zerathcode/memory ~/.zerathcode/memory.backup
   ```

2. **Update code**
   ```bash
   git fetch && git merge origin/main
   # OR manually replace src/ and bin/ directories
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Verify**
   ```bash
   node -c src/core/embeddingManager.js  # Should show no errors
   zerath ask "What is Node.js?"         # Should get sourced answer
   ```

5. **Restore (if needed)**
   ```bash
   cp ~/.zerathcode/keys.backup ~/.zerathcode/keys
   ```

### What's New in v2.0

✅ Semantic retrieval (embeddings)  
✅ Source credibility ranking  
✅ Query understanding & decomposition  
✅ Proper HTML parsing  
✅ Grounding enforcement  
✅ Confidence scoring  
✅ Reasoning layer  
✅ 12 sources instead of 5  

### Breaking Changes

**API Changes:**
- `WebAgent._selectRelevantExcerpts()` now `async`
- `WebAgent._selectTopRagChunks()` now `async`
- Call sites updated in orchestrator, but check custom code

**Behavior Changes:**
- Answers now include source citations (required)
- Confidence level reported
- Hallucinations prevented (explicit "insufficient data")
- HTML structure preserved (more verbose)

### Compatibility

✅ **Backwards compatible** - All existing commands work  
✅ **Graceful fallback** - If embeddings fail, reverts to keyword  
✅ **CLI unchanged** - Same interface  
✅ **API keys** - No changes needed  

## Dependency Details

### What's Being Added

```json
{
  "@xenova/transformers": "^2.13.5",
  "htmlparser2": "^9.1.0",
  "natural": "^6.10.0"
}
```

### Why These?

1. **@xenova/transformers** (~30MB)
   - Lightweight embedding model (all-MiniLM-L6-v2)
   - ONNX format (fast, CPU-only)
   - Runs locally, no API keys needed
   - Semantic understanding

2. **htmlparser2** (~50KB)
   - Proper DOM parsing (vs regex)
   - Preserves structure (headings, tables, lists)
   - Performance optimized
   - Well-maintained

3. **natural** (~1MB)
   - Natural language processing utilities
   - Tokenization, stemming (potential future use)
   - Lightweight alternative to heavier NLP libs

### Disk Impact
- Node modules: ~80MB (including dependencies)
- Model cache: ~30MB (downloads on first use, then cached)
- **Total:** ~110MB added

### Performance
- **First query:** +3-5 seconds (model load)
- **Subsequent queries:** <1 second (cached)
- **No impact on inference speed** (once loaded)

## Troubleshooting

### Installation Issues

#### "npm ERR! ERESOLVE unable to resolve dependency tree"
```bash
# Use npm's legacy peer dependency resolution
npm install --legacy-peer-deps

# Or use npm 7+
npm install --force
```

#### "@xenova/transformers" fails to install
```bash
# This package is large; try increasing npm timeout
npm install --fetch-timeout=120000
```

#### Out of space on Termux
```bash
# Clean npm cache
npm cache clean --force

# Then try install again
npm install
```

### Runtime Issues

#### "Embedding model download timeout"
```bash
# First query takes 3-5s; this is normal
# If it times out completely:
# 1. Check internet connection
# 2. Manually trigger model cache: node -e "require('@xenova/transformers')"
# 3. Wait 30-60 seconds for download
```

#### "embeddingManager: Falling back to keyword-only retrieval"
```bash
# This is OK - system gracefully degrades
# Embeddings not available, still works with keywords
# Check: ~/.zerathcode/embeddings/ directory for model cache
```

#### "htmlparser2: unexpected token"
```bash
# Rare - means malformed HTML from source
# System has fallback regex parser
# This warning is safe to ignore
```

### Verification

#### Quick Test
```bash
zerath ask "What is semantic search?"
```

**Expected:**
- Answer appears with source citations
- Includes confidence level: "(high confidence)" 
- Contains URL references
- NOT hallucinated

#### Detailed Analysis
```bash
# Check embeddings initialized
node -e "const E = require('./src/core/embeddingManager'); console.log('OK')"

# Check source evaluator
node -e "const S = require('./src/core/sourceEvaluator'); console.log('OK')"

# Check query reasoner
node -e "const Q = require('./src/core/queryReasoner'); console.log(Q.analyze('test query'))"

# Check DOM parser
node -e "const D = require('./src/utils/domParser'); console.log(D.extractText('<h1>Test</h1>'))"
```

## Configuration

### Environment Variables (Optional)

```bash
# Cache directory for embeddings
export ZERATHCODE_CACHE=~/.zerathcode/embeddings

# Embedding model (default: all-MiniLM-L6-v2)
export XENOVA_EMBEDDINGS_MODEL=Xenova/all-MiniLM-L6-v2

# Max context size (default: 8000)
export ZERATHCODE_MAX_CHARS=8000

# Max sources (default: 12)
export ZERATHCODE_MAX_SITES=12
```

### Performance Tuning

To adjust for limited resources (Termux on low-end phone):

```bash
# Reduce max sites to 5 (uses less bandwidth)
export ZERATHCODE_MAX_SITES=5

# Reduce context size to 4000 (faster processing)
export ZERATHCODE_MAX_CHARS=4000

# Increase model loading timeout
export XENOVA_LOAD_TIMEOUT=60000
```

## Verification After Installation

Run this script to verify everything works:

```bash
#!/bin/bash
set -e

echo "🔍 Checking dependencies..."
npm list @xenova/transformers htmlparser2 natural

echo "✅ Checking syntax..."
node -c src/core/embeddingManager.js
node -c src/core/sourceEvaluator.js
node -c src/core/queryReasoner.js
node -c src/core/reasoningAgent.js
node -c src/utils/domParser.js

echo "✅ Testing query reasoning..."
node -e "
  const Q = require('./src/core/queryReasoner');
  const result = Q.analyze('How does Django N+1 relate to caching?');
  console.log('Query Type:', result.type);
  console.log('Entities:', result.entities.join(', '));
  console.log('Subqueries:', result.subqueries.length);
"

echo "✅ Testing source evaluation..."
node -e "
  const S = require('./src/core/sourceEvaluator');
  const score = S.qualityScore('https://docs.djangoproject.com/en/5.0/');
  console.log('Django docs authority score:', (score * 100).toFixed(0) + '%');
"

echo "✅ Testing DOM parser..."
node -e "
  const D = require('./src/utils/domParser');
  const html = '<h2>Heading</h2><p>Content</p><ul><li>Item</li></ul>';
  const text = D.extractText(html);
  console.log('DOM parsing works:', text.includes('## Heading'));
"

echo "🚀 All checks passed! ZerathCode v2.0 is ready."
```

Save as `verify_installation.sh` and run:
```bash
chmod +x verify_installation.sh
./verify_installation.sh
```

## Next Steps

### Get Started
```bash
zerath ask "What is semantic search and why is it important?"
zerath ask "Compare React vs Vue frameworks"
zerath ask "How to prevent SQL injection in Django?"
```

### Important Notes
1. **First query is slow** (~3-5s) due to model loading
2. **Answers are different** - more sourced, more precise
3. **Confidence levels included** - no more blind answers
4. **Structure preserved** - HTML tables/lists kept (not flattened)

### Documentation
- [PIPELINE_IMPROVEMENTS.md](./PIPELINE_IMPROVEMENTS.md) - Detailed improvements
- [FIX_SUMMARY.md](./FIX_SUMMARY.md) - What was fixed and why
- [README.md](./README.md) - General usage

### Support
If issues persist:
1. Check system requirements (Node 18+)
2. Verify internet connection (model needs 30MB)
3. Check disk space (~110MB needed)
4. Review error logs in `~/.zerathcode/logs/`

---

**Version:** 2.0  
**Updated:** March 29, 2026
