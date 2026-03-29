# Add project specific ProGuard rules here.
-keep class com.localai.automation.data.entities.** { *; }
-keep class com.localai.automation.models.** { *; }
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn okhttp3.**
