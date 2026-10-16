#!/usr/bin/env sh
set -eu

REPO_URL="https://github.com/heyshop464-bot/R3A-Group-R3A-AI.git"
PROJECT_DIR="$(pwd)"

if ! command -v git >/dev/null 2>&1; then
  echo "Git غير مثبت. ثبّت Git أولًا ثم أعد تشغيل السكربت."
  exit 1
fi
if [ ! -f "$PROJECT_DIR/package.json" ] || [ ! -d "$PROJECT_DIR/src" ] || [ ! -d "$PROJECT_DIR/public" ] || [ ! -d "$PROJECT_DIR/prisma" ]; then
  echo "شغّل السكربت من داخل مجلد R3A_AI_fullstack بعد فك ضغط الحزمة الصحيحة."
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT HUP INT TERM
REPO_DIR="$TMP_DIR/repo"

echo "استنساخ المستودع الحالي حتى لا يتم الكتابة فوق تاريخه..."
git clone "$REPO_URL" "$REPO_DIR"

# Copy the complete project while preserving src/, public/, prisma/, test/, and .github/.
# Exclude any local Git metadata if the extracted project was previously initialized.
for item in "$PROJECT_DIR"/* "$PROJECT_DIR"/.[!.]*; do
  [ -e "$item" ] || continue
  name="$(basename "$item")"
  [ "$name" = ".git" ] && continue
  cp -R "$item" "$REPO_DIR/"
done

cd "$REPO_DIR"
# Remove legacy flattened files that were uploaded at the repository root by mistake.
rm -f create-admin.js server.js schema.prisma migration.sql migration_lock.toml project.test.js index.html

git add -A
if git diff --cached --quiet; then
  echo "لا توجد تغييرات جديدة لرفعها."
  exit 0
fi
git config user.name "R3A AI Project Uploader"
git config user.email "r3a-ai-uploader@users.noreply.github.com"
git commit -m "Fix R3A AI source directory structure and CI"
echo "رفع الملفات إلى GitHub..."
git push origin HEAD:main
echo "اكتمل الرفع. افتح تبويب Actions في GitHub لمراجعة الاختبارات."
