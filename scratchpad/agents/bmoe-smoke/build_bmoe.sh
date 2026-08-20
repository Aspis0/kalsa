#!/bin/bash
cd "C:/Users/gualt/Desktop/Kalsa/moe-experiments"
"C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe" --build BigMoeOnEdge/build-android-opencl-smoke --target bmoe-cli 2>&1
echo "BUILD_EXIT=$?"
