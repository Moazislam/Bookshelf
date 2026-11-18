use crate::error::AppResult;
use image::codecs::jpeg::JpegEncoder;
use std::path::{Path, PathBuf};

pub const COVER_MAX_W: u32 = 480;
pub const COVER_MAX_H: u32 = 720;

/// Decode any supported image, downscale it and store it as a JPEG thumbnail.
pub fn save_cover(bytes: &[u8], covers_dir: &Path, doc_id: &str) -> AppResult<PathBuf> {
    let img = image::load_from_memory(bytes)?;
    let thumb = img.thumbnail(COVER_MAX_W, COVER_MAX_H).to_rgb8();
    std::fs::create_dir_all(covers_dir)?;
    let dest = covers_dir.join(format!("{doc_id}.jpg"));
    let tmp = covers_dir.join(format!("{doc_id}.jpg.tmp"));
    {
        let mut file = std::io::BufWriter::new(std::fs::File::create(&tmp)?);
        JpegEncoder::new_with_quality(&mut file, 86).encode_image(&thumb)?;
    }
    std::fs::rename(&tmp, &dest)?;
    Ok(dest)
}

pub fn is_image_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].iter().any(|e| n.ends_with(e))
}

pub fn image_mime(name: &str) -> &'static str {
    let n = name.to_ascii_lowercase();
    if n.ends_with(".png") {
        "image/png"
    } else if n.ends_with(".gif") {
        "image/gif"
    } else if n.ends_with(".webp") {
        "image/webp"
    } else if n.ends_with(".bmp") {
        "image/bmp"
    } else {
        "image/jpeg"
    }
}
