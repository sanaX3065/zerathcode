@rem Gradle startup script for Windows
@if "%DEBUG%"=="" @echo off
setlocal
set GRADLE_APP_NAME=Gradle
set APP_HOME=%~dp0
set CLASSPATH=%APP_HOME%\gradle\wrapper\gradle-wrapper.jar
java -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
endlocal
