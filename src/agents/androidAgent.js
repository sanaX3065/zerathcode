/**
 * src/agents/androidAgent.js
 * ZerathCode — Android Builder Agent
 * Author: sanaX3065
 *
 * Build Android apps from Termux using Gradle CLI.
 *
 * Commands:
 *   hex android init <AppName> [--kotlin|--java] [--package com.example.app]
 *   hex android build [dir] [--release]
 *   hex android install [dir]
 *   hex android watch [dir]
 *   hex android clean [dir]
 *   hex android check
 */

"use strict";

const fs        = require("fs");
const path      = require("path");
const os        = require("os");
const BaseAgent = require("./baseAgent");
const shell     = require("../utils/shell");
const { ask, confirm } = require("../utils/prompt");
const { Spinner }      = require("../utils/spinner");
const FileWatcher      = require("../utils/fileWatcher");

// Templates for generated files
const TEMPLATES = {
  // ── settings.gradle ──────────────────────────────────────────────────────
  settingsGradle: (appName) =>
`pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "${appName}"
include ':app'
`,

  // ── build.gradle (project level) ─────────────────────────────────────────
  projectBuildGradle: () =>
`// Top-level build file
plugins {
    id 'com.android.application' version '8.2.0' apply false
    id 'org.jetbrains.kotlin.android' version '1.9.22' apply false
}
`,

  // ── app/build.gradle ─────────────────────────────────────────────────────
  appBuildGradle: (pkg, useKotlin) =>
`plugins {
    id 'com.android.application'
    ${useKotlin ? "id 'org.jetbrains.kotlin.android'" : ""}
}

android {
    namespace '${pkg}'
    compileSdk 34

    defaultConfig {
        applicationId "${pkg}"
        minSdk 24
        targetSdk 34
        versionCode 1
        versionName "1.0"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    ${useKotlin ? `kotlinOptions {
        jvmTarget = '17'
    }` : ""}
}

dependencies {
    implementation 'androidx.core:core-ktx:1.12.0'
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'com.google.android.material:material:1.11.0'
    implementation 'androidx.constraintlayout:constraintlayout:2.1.4'
}
`,

  // ── AndroidManifest.xml ───────────────────────────────────────────────────
  manifest: (pkg, appName) =>
`<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="${appName}"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.Light.DarkActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
`,

  // ── MainActivity.kt ───────────────────────────────────────────────────────
  mainActivityKt: (pkg, appName) =>
`package ${pkg}

import androidx.appcompat.app.AppCompatActivity
import android.os.Bundle
import android.widget.TextView

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // HexOverlord generated — sanaX3065
        val textView = findViewById<TextView>(R.id.textView)
        textView.text = "Welcome to ${appName}!"
    }
}
`,

  // ── MainActivity.java ─────────────────────────────────────────────────────
  mainActivityJava: (pkg, appName) =>
`package ${pkg};

import androidx.appcompat.app.AppCompatActivity;
import android.os.Bundle;
import android.widget.TextView;

// HexOverlord generated — sanaX3065
public class MainActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        TextView textView = findViewById(R.id.textView);
        textView.setText("Welcome to ${appName}!");
    }
}
`,

  // ── activity_main.xml ─────────────────────────────────────────────────────
  activityMainXml: () =>
`<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <TextView
        android:id="@+id/textView"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Hello World!"
        android:textSize="24sp"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintLeft_toLeftOf="parent"
        app:layout_constraintRight_toRightOf="parent"
        app:layout_constraintTop_toTopOf="parent" />

</androidx.constraintlayout.widget.ConstraintLayout>
`,

  // ── strings.xml ───────────────────────────────────────────────────────────
  stringsXml: (appName) =>
`<resources>
    <string name="app_name">${appName}</string>
</resources>
`,

  // ── gradle.properties ─────────────────────────────────────────────────────
  gradleProperties: () =>
`android.useAndroidX=true
android.enableJetifier=true
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
org.gradle.parallel=true
kotlin.code.style=official
`,

  // ── .gitignore ────────────────────────────────────────────────────────────
  gitignore: () =>
`*.iml
.gradle
/local.properties
/.idea
.DS_Store
/build
/captures
/app/build
.externalNativeBuild
.cxx
local.properties
`,

  // ── proguard-rules.pro ────────────────────────────────────────────────────
  proguardRules: () =>
`# ZerathCode generated — Add project-specific ProGuard rules here.
# See http://proguard.sourceforge.net/manual/usage.html
`,
};

class AndroidAgent extends BaseAgent {
  async run(args) {
    const command = args[0];
    if (!command) { this._help(); return; }

    switch (command.toLowerCase()) {
      case "init":    return this._init(args.slice(1));
      case "build":   return this._build(args.slice(1));
      case "install": return this._install(args.slice(1));
      case "watch":   return this._watch(args.slice(1));
      case "clean":   return this._clean(args.slice(1));
      case "check":   return this._checkEnv();
      default:
        this.log.fail(`Unknown android command: "${command}"`);
        this._help();
        process.exit(1);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async _init(args) {
    if (args.length === 0) this.usageError("hex android init <AppName> [--kotlin|--java] [--package com.example.app]");

    const appName    = args[0];
    const useKotlin  = !args.includes("--java");  // default Kotlin
    const pkgIdx     = args.indexOf("--package");
    const pkg        = pkgIdx !== -1
      ? args[pkgIdx + 1]
      : `com.zerathcode.${appName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

    const lang = useKotlin ? "Kotlin" : "Java";

    // Validate app name
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(appName)) {
      this.log.fail(`Invalid app name: "${appName}". Use letters, numbers, underscores. Must start with a letter.`);
      process.exit(1);
    }

    const projectDir = await this.safePath(appName);

    if (fs.existsSync(projectDir)) {
      this.log.fail(`Directory "${appName}" already exists.`);
      process.exit(1);
    }

    console.log(`\n\x1b[35m╔══════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[35m║   🤖 Android Project Generator               ║\x1b[0m`);
    console.log(`\x1b[35m╚══════════════════════════════════════════════╝\x1b[0m`);
    console.log(`  App Name:  \x1b[33m${appName}\x1b[0m`);
    console.log(`  Package:   \x1b[36m${pkg}\x1b[0m`);
    console.log(`  Language:  \x1b[32m${lang}\x1b[0m`);
    console.log(`  Directory: \x1b[90m${projectDir}\x1b[0m\n`);

    // ── Scaffold directory structure ─────────────────────────────────────────
    const srcLang = useKotlin ? "kotlin" : "java";
    const pkgPath = pkg.replace(/\./g, path.sep);

    const dirs = [
      projectDir,
      path.join(projectDir, "app", "src", "main", srcLang, pkgPath),
      path.join(projectDir, "app", "src", "main", "res", "layout"),
      path.join(projectDir, "app", "src", "main", "res", "values"),
      path.join(projectDir, "app", "src", "main", "res", "mipmap-hdpi"),
      path.join(projectDir, "app", "src", "debug"),
    ];

    for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });

    // ── Write all template files ─────────────────────────────────────────────
    const files = [
      // Root project files
      [path.join(projectDir, "settings.gradle"),         TEMPLATES.settingsGradle(appName)],
      [path.join(projectDir, "build.gradle"),            TEMPLATES.projectBuildGradle()],
      [path.join(projectDir, "gradle.properties"),       TEMPLATES.gradleProperties()],
      [path.join(projectDir, ".gitignore"),              TEMPLATES.gitignore()],
      // App module
      [path.join(projectDir, "app", "build.gradle"),     TEMPLATES.appBuildGradle(pkg, useKotlin)],
      [path.join(projectDir, "app", "proguard-rules.pro"), TEMPLATES.proguardRules()],
      // Manifest
      [path.join(projectDir, "app", "src", "main", "AndroidManifest.xml"), TEMPLATES.manifest(pkg, appName)],
      // Source file
      useKotlin
        ? [path.join(projectDir, "app", "src", "main", srcLang, pkgPath, "MainActivity.kt"), TEMPLATES.mainActivityKt(pkg, appName)]
        : [path.join(projectDir, "app", "src", "main", srcLang, pkgPath, "MainActivity.java"), TEMPLATES.mainActivityJava(pkg, appName)],
      // Resources
      [path.join(projectDir, "app", "src", "main", "res", "layout", "activity_main.xml"), TEMPLATES.activityMainXml()],
      [path.join(projectDir, "app", "src", "main", "res", "values", "strings.xml"),       TEMPLATES.stringsXml(appName)],
    ];

    files.forEach(([filePath, content]) => {
      fs.writeFileSync(filePath, content, "utf8");
      console.log(`  \x1b[90m+  ${path.relative(projectDir, filePath)}\x1b[0m`);
    });

    // ── Download Gradle wrapper ──────────────────────────────────────────────
    await this._setupGradleWrapper(projectDir);

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log(`\n\x1b[32m✔  Project "${appName}" created!\x1b[0m\n`);
    console.log(`\x1b[36mNext steps:\x1b[0m`);
    console.log(`  1. \x1b[33mcd ${appName}\x1b[0m`);
    console.log(`  2. \x1b[33mhex android build\x1b[0m`);
    console.log(`  3. \x1b[33mhex android install\x1b[0m  (after build)\n`);

    console.log(`\x1b[90mNote: Building requires Java 17+\x1b[0m`);
    console.log(`  \x1b[90mpkg install openjdk-17\x1b[0m`);
    console.log(`\x1b[90mAnd the Android SDK configured with ANDROID_HOME set.\x1b[0m\n`);
  }

  // ── Build ──────────────────────────────────────────────────────────────────
  async _build(args) {
    const isRelease = args.includes("--release");
    const dir       = args.find((a) => !a.startsWith("--")) || ".";
    const resolved  = await this.safePath(dir);

    if (!fs.existsSync(path.join(resolved, "settings.gradle"))) {
      this.log.fail(`"${dir}" doesn't look like an Android project (no settings.gradle).`);
      process.exit(1);
    }

    this._checkJava();

    const task = isRelease ? "assembleRelease" : "assembleDebug";
    console.log(`\n\x1b[35m⟶  Building Android APK\x1b[0m  (\x1b[33m${isRelease ? "RELEASE" : "DEBUG"}\x1b[0m)\n`);

    const gradlew = path.join(resolved, "gradlew");
    const useWrapper = fs.existsSync(gradlew);

    const gradleCmd  = useWrapper ? "./gradlew" : "gradle";
    const gradleArgs = useWrapper ? [task] : [task];

    if (useWrapper) {
      fs.chmodSync(gradlew, "755");
    }

    try {
      await shell.run(gradleCmd, gradleArgs, { cwd: resolved });
    } catch (err) {
      this.log.fail(`Build failed: ${err.message}`);
      console.log(`\n\x1b[33mTroubleshooting:\x1b[0m`);
      console.log(`  • Ensure JAVA_HOME is set: \x1b[90mexport JAVA_HOME=/data/data/com.termux/files/usr\x1b[0m`);
      console.log(`  • Ensure ANDROID_HOME is set correctly`);
      console.log(`  • Run: \x1b[90mhex android check\x1b[0m`);
      process.exit(1);
    }

    // Locate generated APK
    const apkDir = path.join(resolved, "app", "build", "outputs", "apk",
      isRelease ? "release" : "debug");
    const apkName = isRelease ? "app-release-unsigned.apk" : "app-debug.apk";
    const apkPath = path.join(apkDir, apkName);

    console.log(`\n\x1b[32m✔  Build complete!\x1b[0m`);

    if (fs.existsSync(apkPath)) {
      const stat = fs.statSync(apkPath);
      const sizeMb = (stat.size / 1024 / 1024).toFixed(2);
      console.log(`  APK:  \x1b[33m${apkPath}\x1b[0m`);
      console.log(`  Size: \x1b[90m${sizeMb} MB\x1b[0m`);
      console.log(`\nRun \x1b[36mhex android install\x1b[0m to install on device.\n`);
    }
  }

  // ── Install ────────────────────────────────────────────────────────────────
  async _install(args) {
    const isRelease = args.includes("--release");
    const dir       = args.find((a) => !a.startsWith("--")) || ".";
    const resolved  = await this.safePath(dir);

    const apkDir  = path.join(resolved, "app", "build", "outputs", "apk",
      isRelease ? "release" : "debug");
    const apkName = isRelease ? "app-release-unsigned.apk" : "app-debug.apk";
    const apkPath = path.join(apkDir, apkName);

    if (!fs.existsSync(apkPath)) {
      this.log.fail(`APK not found: ${apkPath}\nRun \x1b[33mhex android build\x1b[0m first.`);
      process.exit(1);
    }

    const adbAvailable = shell.isAvailable("adb");

    console.log(`\n\x1b[35m── Install APK ──────────────────────────────────\x1b[0m`);
    console.log(`  APK: \x1b[33m${apkPath}\x1b[0m\n`);

    if (adbAvailable) {
      // Try ADB install
      console.log(`\x1b[36mAttempting ADB install (requires USB debugging enabled)…\x1b[0m\n`);
      try {
        await shell.run("adb", ["install", "-r", apkPath]);
        this.log.success("APK installed via ADB!");
      } catch {
        this._printManualInstall(apkPath);
      }
    } else {
      this._printManualInstall(apkPath);
    }
  }

  _printManualInstall(apkPath) {
    console.log(`\x1b[36m── Manual Installation Instructions ──────────────\x1b[0m`);
    console.log(`\n  Option 1: \x1b[33mFile Manager\x1b[0m`);
    console.log(`    1. Open your file manager app`);
    console.log(`    2. Navigate to: \x1b[90m${apkPath}\x1b[0m`);
    console.log(`    3. Tap the APK to install`);
    console.log(`    4. Allow "Install from unknown sources" if prompted\n`);

    console.log(`  Option 2: \x1b[33mTermux Share\x1b[0m`);
    console.log(`    \x1b[90mtermux-open ${apkPath}\x1b[0m\n`);

    console.log(`  Option 3: \x1b[33mADB (USB debugging)\x1b[0m`);
    console.log(`    \x1b[90mpkg install android-tools\x1b[0m`);
    console.log(`    \x1b[90madb install -r "${apkPath}"\x1b[0m\n`);

    console.log(`  Option 4: \x1b[33mCopy to /sdcard\x1b[0m`);
    console.log(`    \x1b[90mcp "${apkPath}" /sdcard/Download/\x1b[0m\n`);
  }

  // ── Watch (auto-rebuild) ───────────────────────────────────────────────────
  async _watch(args) {
    const dir      = args[0] || ".";
    const resolved = await this.safePath(dir);

    console.log(`\n\x1b[35m⟶  Watching for changes in: ${path.basename(resolved)}\x1b[0m`);
    console.log(`\x1b[90m   Press Ctrl+C to stop.\x1b[0m\n`);

    const srcDir = path.join(resolved, "app", "src");
    let building = false;

    const watcher = new FileWatcher(srcDir, { debounceMs: 1500, verbose: true });

    watcher.on("change", async ({ filename }) => {
      if (building) return;
      building = true;
      console.log(`\n\x1b[33m⟳  Change in "${filename}" — rebuilding…\x1b[0m\n`);
      try {
        await this._build([dir]);
      } catch (err) {
        this.log.fail(`Build error: ${err.message}`);
      }
      building = false;
    });

    watcher.on("error", (err) => {
      this.log.warn(`Watcher error: ${err.message}`);
    });

    watcher.start();

    // Handle Ctrl+C gracefully
    process.on("SIGINT", () => {
      watcher.stop();
      console.log("\n\x1b[90m   Watch stopped.\x1b[0m\n");
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
  }

  // ── Clean ──────────────────────────────────────────────────────────────────
  async _clean(args) {
    const dir      = args[0] || ".";
    const resolved = await this.safePath(dir);
    const buildDir = path.join(resolved, "app", "build");

    if (!fs.existsSync(buildDir)) {
      this.log.note("Nothing to clean.");
      return;
    }

    const ok = await confirm(`\x1b[33mClean build directory?\x1b[0m`);
    if (!ok) { this.log.note("Cancelled."); return; }

    // Run gradle clean if available, else remove manually
    try {
      await shell.run("./gradlew", ["clean"], { cwd: resolved, allowFail: true });
    } catch {
      fs.rmSync(buildDir, { recursive: true, force: true });
    }

    this.log.success("Build directory cleaned.");
  }

  // ── Environment Check ──────────────────────────────────────────────────────
  async _checkEnv() {
    console.log(`\n\x1b[36m── Android Build Environment Check ──────────────\x1b[0m\n`);

    const checks = [
      {
        name: "Node.js",
        check: () => process.version,
        install: null,
      },
      {
        name: "Java (JDK)",
        check: () => { const r = require("child_process").execSync("java -version 2>&1").toString(); return r.split("\n")[0]; },
        install: "pkg install openjdk-17",
      },
      {
        name: "Gradle",
        check: () => { const r = require("child_process").execSync("gradle --version 2>&1").toString(); return r.split("\n")[1] || "found"; },
        install: "pkg install gradle",
      },
      {
        name: "ANDROID_HOME",
        check: () => process.env.ANDROID_HOME || "(not set)",
        install: "export ANDROID_HOME=~/android-sdk",
      },
      {
        name: "JAVA_HOME",
        check: () => process.env.JAVA_HOME || "(not set)",
        install: null,
      },
      {
        name: "ADB",
        check: () => shell.isAvailable("adb") ? "available" : "not found",
        install: "pkg install android-tools",
      },
      {
        name: "Git",
        check: () => shell.isAvailable("git") ? "available" : "not found",
        install: "pkg install git",
      },
    ];

    for (const { name, check, install } of checks) {
      try {
        const val = check();
        const isOk = !String(val).includes("not set") && !String(val).includes("not found");
        const icon = isOk ? "\x1b[32m✔\x1b[0m" : "\x1b[33m⚠\x1b[0m";
        console.log(`  ${icon}  ${name.padEnd(20)} \x1b[90m${String(val).slice(0, 60)}\x1b[0m`);
        if (!isOk && install) {
          console.log(`       \x1b[90mInstall: ${install}\x1b[0m`);
        }
      } catch {
        console.log(`  \x1b[31m✖\x1b[0m  ${name.padEnd(20)} \x1b[31mnot found\x1b[0m`);
        if (install) console.log(`       \x1b[90mInstall: ${install}\x1b[0m`);
      }
    }
    console.log("");
  }

  // ── Setup Gradle Wrapper ───────────────────────────────────────────────────
  async _setupGradleWrapper(projectDir) {
    // Write a minimal gradlew script so the project is self-contained
    const gradlewPath = path.join(projectDir, "gradlew");
    const gradlewContent =
`#!/bin/sh
# Minimal Gradle wrapper generated by ZerathCode
# Replace with a real Gradle wrapper via: gradle wrapper
exec gradle "$@"
`;
    fs.writeFileSync(gradlewPath, gradlewContent, { mode: 0o755 });
    console.log(`  \x1b[90m+  gradlew (wrapper stub)\x1b[0m`);

    // gradlew.bat for Windows users who pull the repo
    const gradlewBatPath = path.join(projectDir, "gradlew.bat");
    fs.writeFileSync(gradlewBatPath,
`@rem Gradle wrapper bat stub
@gradle %*
`, "utf8");
    console.log(`  \x1b[90m+  gradlew.bat\x1b[0m`);
  }

  _checkJava() {
    if (!shell.isAvailable("java")) {
      this.log.fail(
        "Java not found. Install it:\n" +
        "  \x1b[33mpkg install openjdk-17\x1b[0m"
      );
      process.exit(1);
    }
  }

  _help() {
    console.log(`
\x1b[36mAndroid Agent Commands:\x1b[0m
  hex android init <AppName> [--java] [--package com.example.app]
  hex android build [dir] [--release]
  hex android install [dir]
  hex android watch [dir]
  hex android clean [dir]
  hex android check

\x1b[90mRequirements:\x1b[0m
  pkg install openjdk-17 gradle git android-tools
  export ANDROID_HOME=~/android-sdk
  export JAVA_HOME=\$PREFIX
`);
  }
}

module.exports = AndroidAgent;
