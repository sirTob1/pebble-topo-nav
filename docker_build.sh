#!/bin/bash
set -e

# Setup container project directory to avoid Windows host filesystem/locking issues
echo "Copying files to container root..."
rm -rf /root/project
mkdir -p /root/project
cp -r /app/src /root/project/
if [ -d "/app/resources" ]; then cp -r /app/resources /root/project/; fi
cp /app/package.json /root/project/
cp /app/wscript /root/project/

cd /root/project

# Run initial build to unpack compiler tools (expected to fail on python report tool)
echo "Running initial build to unpack tools..."
pebble build || true

# Patch the python 2.7 report memory usage type crash
WAF_PATH=$(find /root/.pebble-sdk/ -name "report_memory_usage.py" | head -n 1)
if [ -n "$WAF_PATH" ]; then
  echo "Patching report_memory_usage.py at $WAF_PATH"
  sed -i 's/def generate_memory_usage_report(task_gen):/def generate_memory_usage_report(task_gen):\n\treturn/g' "$WAF_PATH"
else
  echo "Warning: report_memory_usage.py not found!"
fi

# Clean and run build properly
echo "Cleaning and running build..."
rm -rf build
pebble build

echo "Build succeeded! Copying final PBW file back to host..."
mkdir -p /app/build
cp /root/project/build/*.pbw /app/build/
echo "Done! The compiled pbw file is in d:/Coding/Anitgravity/build/"
