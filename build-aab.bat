@echo off
setlocal
set "JAVA_HOME=C:\ASDK\jdk-17.0.20.1+1"
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "%~dp0android"
echo Starting AAB build with JAVA_HOME=%JAVA_HOME%
call gradlew.bat bundleRelease --no-daemon 2>&1
echo BUILD_EXIT_CODE=%ERRORLEVEL%
endlocal