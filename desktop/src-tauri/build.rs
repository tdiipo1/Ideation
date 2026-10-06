fn main() {
    // IMPORTANT: whisper-rs-sys reads GGML_* env vars to configure cmake.
    // On Windows/MSVC, GGML_NATIVE=ON does nothing (no -march=native support),
    // so AVX2/FMA must be enabled explicitly.
    //
    // These env vars must be set at the SHELL level before building:
    //   export GGML_NATIVE=OFF GGML_AVX=ON GGML_AVX2=ON GGML_FMA=ON GGML_F16C=ON
    //
    // Or on Windows cmd:
    //   set GGML_NATIVE=OFF && set GGML_AVX=ON && set GGML_AVX2=ON && set GGML_FMA=ON && set GGML_F16C=ON

    // Warn if AVX2 is not enabled (common mistake on Windows)
    if std::env::var("GGML_AVX2").unwrap_or_default() != "ON" {
        println!("cargo:warning=GGML_AVX2 is not set to ON. Whisper will be very slow without AVX2. Set GGML_NATIVE=OFF GGML_AVX2=ON GGML_FMA=ON in your environment.");
    }

    tauri_build::build()
}
