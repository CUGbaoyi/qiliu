//! 本机加密存储（Vault）：与 macOS 钥匙串版本、Android Keystore 版本保持相同的密文格式。
//!
//! - `local.key`：32 字节随机密钥，Unix 下权限 0600；
//! - `vault.enc`：`iv(12 字节) || AES-256-GCM 密文（含 16 字节认证标签）`；
//! - 写入先落 `vault.tmp` 再 rename，避免断电/崩溃留下半个文件；
//! - 无 `vault.enc` 时 `read` 返回空字符串，解密失败只返回中文错误、不 panic。

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;

/// 密钥文件名。
const KEY_FILE: &str = "local.key";
/// 密文文件名。
const VAULT_FILE: &str = "vault.enc";
/// 临时文件名。
const TMP_FILE: &str = "vault.tmp";
/// AES-256 密钥长度。
const KEY_LEN: usize = 32;
/// GCM nonce 长度。
const NONCE_LEN: usize = 12;
/// GCM 认证标签长度。
const TAG_LEN: usize = 16;
/// 明文上限：4MB。
const MAX_VAULT_BYTES: usize = 4 * 1024 * 1024;

/// 本机加密存储。只持有目录路径，可安全 `Clone` 后跨线程使用。
#[derive(Clone, Debug)]
pub struct Vault {
    dir: PathBuf,
}

impl Vault {
    /// 打开（必要时创建）数据目录，并确保存在合法的 32 字节本机密钥。
    pub fn open(dir: impl AsRef<Path>) -> Result<Self, String> {
        let dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir).map_err(|_| "无法创建本机数据目录。".to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // 目录权限收紧到 0700；失败不阻断（部分挂载点不支持权限位）。
            let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
        }
        let vault = Self { dir };
        vault.ensure_key()?;
        Ok(vault)
    }

    /// 读取并解密本机数据；文件不存在时返回空字符串。
    pub fn read(&self) -> Result<String, String> {
        let path = self.dir.join(VAULT_FILE);
        let payload = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(String::new()),
            Err(_) => return Err("无法读取本机数据。".to_string()),
        };
        if payload.len() < NONCE_LEN + TAG_LEN {
            return Err("本机数据损坏，无法解密。".to_string());
        }
        let key = self.key()?;
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|_| "无法读取本机密钥。".to_string())?;
        let nonce = Nonce::from_slice(&payload[..NONCE_LEN]);
        let plain = cipher
            .decrypt(nonce, &payload[NONCE_LEN..])
            .map_err(|_| "无法解密本机数据。".to_string())?;
        String::from_utf8(plain).map_err(|_| "本机数据格式无效。".to_string())
    }

    /// 加密并原子替换写入本机数据；明文上限 4MB。
    pub fn write(&self, value: &str) -> Result<(), String> {
        if value.len() > MAX_VAULT_BYTES {
            return Err("本机数据过大。".to_string());
        }
        let key = self.key()?;
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|_| "无法读取本机密钥。".to_string())?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::rngs::OsRng
            .try_fill_bytes(&mut nonce_bytes)
            .map_err(|_| "无法生成加密随机数。".to_string())?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, value.as_bytes())
            .map_err(|_| "无法加密本机数据。".to_string())?;
        let mut payload = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        payload.extend_from_slice(&nonce_bytes);
        payload.extend_from_slice(&ciphertext);

        let tmp = self.dir.join(TMP_FILE);
        let target = self.dir.join(VAULT_FILE);
        fs::write(&tmp, &payload).map_err(|_| "无法写入本机数据。".to_string())?;
        fs::rename(&tmp, &target).map_err(|_| "无法保存本机数据。".to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // 密文文件仅当前用户可读写；失败不阻断。
            let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    /// 读取本机密钥；长度不是 32 字节时视为损坏并拒绝。
    fn key(&self) -> Result<[u8; KEY_LEN], String> {
        let bytes =
            fs::read(self.dir.join(KEY_FILE)).map_err(|_| "无法读取本机密钥。".to_string())?;
        bytes
            .as_slice()
            .try_into()
            .map_err(|_| "本机密钥长度异常。".to_string())
    }

    /// 首次使用时创建 32 字节随机密钥；已存在则只校验，不覆盖。
    fn ensure_key(&self) -> Result<(), String> {
        let path = self.dir.join(KEY_FILE);
        if path.exists() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                // 已有密钥也收紧到 0600；失败不阻断（部分挂载点不支持权限位）。
                let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
            }
            self.key()?;
            return Ok(());
        }
        let mut key = [0u8; KEY_LEN];
        rand::rngs::OsRng
            .try_fill_bytes(&mut key)
            .map_err(|_| "无法生成本机密钥。".to_string())?;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut file) => {
                file.write_all(&key)
                    .map_err(|_| "无法保存本机密钥。".to_string())?;
                file.sync_all()
                    .map_err(|_| "无法保存本机密钥。".to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
                }
            }
            // 并发进程抢先创建了同目录密钥：直接读取，保证各方使用同一把密钥。
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(_) => return Err("无法保存本机密钥。".to_string()),
        }
        self.key().map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_creates_dir_and_key() {
        let root = tempfile::tempdir().expect("临时目录");
        let dir = root.path().join("nested").join("data");
        let vault = Vault::open(&dir).expect("打开 Vault");
        assert!(dir.is_dir(), "应创建数据目录");
        let key = fs::read(dir.join(KEY_FILE)).expect("应生成密钥文件");
        assert_eq!(key.len(), KEY_LEN, "密钥应为 32 字节");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.join(KEY_FILE))
                .expect("读取密钥元数据")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600, "Unix 下密钥文件应为 0600");
        }
        assert!(vault.read().expect("空 Vault 读取").is_empty());
    }

    #[test]
    fn read_write_roundtrip_survives_reopen() {
        let root = tempfile::tempdir().expect("临时目录");
        let vault = Vault::open(root.path()).expect("打开 Vault");
        let value = "{\"mteam\":{\"base\":\"https://api.m-team.cc/api\",\"key\":\"测试\"}}";
        vault.write(value).expect("写入");
        assert_eq!(vault.read().expect("读取"), value);

        // 重新打开（模拟应用重启）：密钥复用，密文仍可解密。
        let reopened = Vault::open(root.path()).expect("重新打开 Vault");
        assert_eq!(reopened.read().expect("重新读取"), value);

        // 密文格式：iv(12) + AES-GCM 密文 + 标签(16)。
        let payload = fs::read(root.path().join(VAULT_FILE)).expect("读取密文");
        assert_eq!(payload.len(), NONCE_LEN + value.len() + TAG_LEN);
    }

    #[test]
    fn wrong_key_fails_without_panicking() {
        let root = tempfile::tempdir().expect("临时目录");
        let vault = Vault::open(root.path()).expect("打开 Vault");
        vault.write("本机凭据").expect("写入");

        // 换一把密钥后解密必须失败，且给出中文错误。
        let other = [7u8; KEY_LEN];
        fs::write(root.path().join(KEY_FILE), other).expect("覆盖密钥");
        let error = vault.read().expect_err("错密钥不应解密成功");
        assert!(error.contains("解密"), "错误信息应为中文解密失败：{error}");
    }

    #[test]
    fn tampered_ciphertext_fails_without_panicking() {
        let root = tempfile::tempdir().expect("临时目录");
        let vault = Vault::open(root.path()).expect("打开 Vault");
        vault.write("本机凭据").expect("写入");

        let path = root.path().join(VAULT_FILE);
        let mut payload = fs::read(&path).expect("读取密文");
        let last = payload.len() - 1;
        payload[last] ^= 0xff;
        fs::write(&path, payload).expect("篡改密文");
        assert!(vault.read().is_err(), "篡改后必须解密失败");
    }

    #[test]
    fn invalid_key_length_is_rejected() {
        let root = tempfile::tempdir().expect("临时目录");
        fs::write(root.path().join(KEY_FILE), b"short").expect("写入错误密钥");
        let error = Vault::open(root.path()).expect_err("长度错误的密钥必须拒绝");
        assert!(error.contains("长度"), "错误信息应提示密钥长度：{error}");
    }

    #[test]
    fn oversized_value_is_rejected() {
        let root = tempfile::tempdir().expect("临时目录");
        let vault = Vault::open(root.path()).expect("打开 Vault");
        let value = "a".repeat(MAX_VAULT_BYTES + 1);
        assert!(vault.write(&value).is_err(), "超过 4MB 必须拒绝");
        assert!(vault.read().expect("失败写入后仍可读取").is_empty());
    }

    #[test]
    fn truncated_ciphertext_is_rejected() {
        let root = tempfile::tempdir().expect("临时目录");
        let vault = Vault::open(root.path()).expect("打开 Vault");
        fs::write(root.path().join(VAULT_FILE), [0u8; 8]).expect("写入截断密文");
        assert!(vault.read().is_err(), "截断密文必须拒绝");
    }
}
