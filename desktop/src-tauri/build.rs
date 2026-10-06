fn main() {
    // whisper-rs-sys forwards GGML_* environment variables to CMake, but it
    // keeps whatever flags its *cached* build was configured with: changing
    // the variables only takes effect after deleting
    // target/<profile>/build/whisper-rs-sys-* so CMake reconfigures.
    //
    // For a distributable release build set (shell level):
    //   GGML_NATIVE=OFF GGML_AVX=ON GGML_AVX2=ON GGML_FMA=ON GGML_F16C=ON
    // which targets x86-64-v3 (the binary then requires AVX2 hardware, i.e.
    // any x86 CPU since ~2013). GGML_NATIVE=ON tunes for the build machine
    // and may not run elsewhere. See README "Building".
    //
    // GPU: build with `--features gpu-vulkan` (Windows/Linux, needs the
    // Vulkan SDK: VULKAN_SDK + glslc) or `--features gpu-metal` (macOS).
    let is_release = std::env::var("PROFILE").map(|p| p == "release").unwrap_or(false);
    let avx2_requested = std::env::var("GGML_AVX2").map(|v| v == "ON").unwrap_or(false);
    if is_release && !avx2_requested {
        println!(
            "cargo:warning=GGML_AVX2 is not set in this environment. whisper-rs-sys keeps the \
             flags of its cached build; for a fresh release build set GGML_NATIVE=OFF \
             GGML_AVX2=ON GGML_FMA=ON GGML_F16C=ON so Whisper runs at full speed."
        );
    }

    tauri_build::build()
}
