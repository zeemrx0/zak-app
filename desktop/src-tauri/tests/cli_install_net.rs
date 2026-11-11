//! End to end install of the zak CLI into a temporary HOME. It hits the network, so it runs only when
//! `ZAK_DESKTOP_NET_TESTS=1`. HOME is moved to a temp dir before anything reads it, so the real
//! `~/.local/bin` is never touched.

use zak_desktop_lib::cli_install::{install, Channel};
use zak_desktop_lib::tools;

#[test]
fn installs_zak_into_a_temp_home() {
    if std::env::var("ZAK_DESKTOP_NET_TESTS").as_deref() != Ok("1") {
        eprintln!("skipped: set ZAK_DESKTOP_NET_TESTS=1 to run the network install test");
        return;
    }
    let base = std::env::var_os("ZAK_DESKTOP_NET_TEST_DIR").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let home = base.join(format!("zak-desktop-home-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(&home).unwrap();
    std::env::set_var("HOME", &home);

    assert!(!home.join(".local/bin/zak").exists(), "zak must not exist yet");
    let result = install(Channel::Stable).expect("install runs");
    eprintln!("exit_code={}\nstdout={}\nstderr={}\nversion={:?}", result.exit_code, result.stdout, result.stderr, result.version);
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    let installed = home.join(".local/bin/zak");
    assert!(installed.is_file(), "{} exists", installed.display());
    // The cached PATH appends ~/.local/bin, so a fresh lookup finds the new binary without a restart. A zak
    // earlier on the developer's own PATH may win `find_zak`, so check the appended entry itself.
    assert!(tools::child_path().ends_with(&format!("{}/.local/bin", home.display())));
    assert_eq!(tools::find_in_path("zak", &format!("{}/.local/bin", home.display())).as_deref(), Some(installed.as_path()));
    assert!(tools::find_zak().is_some());
    assert!(tools::status().zak.path.is_some());
    assert!(result.version.is_some());
    eprintln!("installed path: {}", installed.display());
    let _ = std::fs::remove_dir_all(&home);
}
