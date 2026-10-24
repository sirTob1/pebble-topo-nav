#!/bin/bash
set -e

# Copy project files to a local container directory to avoid Windows file locks & permission bugs
echo "Copying project files to a local container directory..."
rm -rf /root/project
mkdir -p /root/project
cp -r /app/src /root/project/
if [ -d "/app/resources" ]; then cp -r /app/resources /root/project/; fi
cp /app/package.json /root/project/
cp /app/wscript /root/project/

cd /root/project

echo "Cleaning previous builds inside container..."
pebble clean || true

echo "Running first build to unpack build tools (expected to fail)..."
pebble build || true

echo "Locating build tool report_memory_usage.py..."
WAF_PATH=$(find /root/.pebble-sdk/ -name "report_memory_usage.py" | head -n 1)

if [ -n "$WAF_PATH" ]; then
  echo "Found script at: $WAF_PATH"
  echo "Original lines:"
  sed -n '35,42p' "$WAF_PATH"
  
  echo "Patching Python 2.7 dict/list conflict by disabling reporting..."
  # Immediately return from generate_memory_usage_report
  sed -i 's/def generate_memory_usage_report(task_gen):/def generate_memory_usage_report(task_gen):\n\treturn/g' "$WAF_PATH"
  
  echo "Patched lines:"
  sed -n '35,42p' "$WAF_PATH"
else
  echo "Warning: report_memory_usage.py not found!"
fi

echo "Cleaning build cache in container to force a fresh configure..."
rm -rf build

echo "Running second build..."
pebble build
echo "Build finished successfully!"

echo "Copying compiled watchapp back to the Windows host volume..."
mkdir -p /app/build
cp /root/project/build/*.pbw /app/build/

echo "Build finished successfully!"
