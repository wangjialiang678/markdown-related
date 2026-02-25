use pulldown_cmark::{html, Options, Parser};
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RenderedMarkdown {
    pub path: String,
    pub file_name: String,
    pub base_dir: String,
    pub raw_markdown: String,
    pub html: String,
    pub headings: Vec<Heading>,
    pub modified_unix_ms: u64,
}

pub fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd"
            )
        })
        .unwrap_or(false)
}

pub fn normalize_input_path(raw: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err("Empty file path".to_string());
    }

    let parsed = if raw.starts_with("file://") {
        url::Url::parse(raw)
            .map_err(|_| "Invalid file URL".to_string())?
            .to_file_path()
            .map_err(|_| "Could not convert file URL to path".to_string())?
    } else {
        PathBuf::from(raw)
    };

    if parsed.is_absolute() {
        Ok(parsed)
    } else {
        let cwd = std::env::current_dir()
            .map_err(|e| format!("Failed to resolve current directory: {e}"))?;
        Ok(cwd.join(parsed))
    }
}

pub fn render_markdown_file(path: &Path) -> Result<RenderedMarkdown, String> {
    if !path.exists() {
        return Err(format!("File does not exist: {}", path.display()));
    }

    if !is_markdown_path(path) {
        return Err(format!("Unsupported file extension: {}", path.display()));
    }

    let raw = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read markdown file {}: {e}", path.display()))?;

    let (html, headings) = markdown_to_html_with_toc(&raw);

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Untitled")
        .to_string();

    let base_dir = path
        .parent()
        .unwrap_or_else(|| Path::new("/"))
        .to_string_lossy()
        .to_string();

    let modified_unix_ms = path
        .metadata()
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    Ok(RenderedMarkdown {
        path: path.to_string_lossy().to_string(),
        file_name,
        base_dir,
        raw_markdown: raw,
        html,
        headings,
        modified_unix_ms,
    })
}

pub fn render_markdown_text(file_name: String, raw_markdown: String) -> RenderedMarkdown {
    let (html, headings) = markdown_to_html_with_toc(&raw_markdown);

    RenderedMarkdown {
        path: format!("virtual://{file_name}"),
        file_name,
        base_dir: String::new(),
        raw_markdown,
        html,
        headings,
        modified_unix_ms: 0,
    }
}

fn markdown_to_html_with_toc(markdown: &str) -> (String, Vec<Heading>) {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(markdown, options);
    let mut raw_html = String::new();
    html::push_html(&mut raw_html, parser);

    let sanitized = ammonia::clean(&raw_html);
    inject_heading_ids(&sanitized)
}

fn inject_heading_ids(html: &str) -> (String, Vec<Heading>) {
    let heading_regex = Regex::new(r"(?s)<h([1-6])>(.*?)</h[1-6]>").expect("valid heading regex");
    let tag_regex = Regex::new(r"(?s)<[^>]+>").expect("valid strip-tags regex");

    let mut headings = Vec::new();
    let mut slug_counts: HashMap<String, usize> = HashMap::new();
    let mut output = String::with_capacity(html.len() + 64);
    let mut last_index = 0;

    for captures in heading_regex.captures_iter(html) {
        let whole = captures.get(0).expect("heading full match");
        let level_text = captures.get(1).expect("heading level").as_str();
        let body_html = captures.get(2).expect("heading body").as_str();

        output.push_str(&html[last_index..whole.start()]);

        let stripped = tag_regex.replace_all(body_html, "");
        let normalized_text = stripped.trim();
        let base_slug = slugify(normalized_text);

        let count = slug_counts.entry(base_slug.clone()).or_insert(0);
        let heading_id = if *count == 0 {
            base_slug.clone()
        } else {
            format!("{base_slug}-{count}")
        };
        *count += 1;

        let level = level_text.parse::<u8>().unwrap_or(1);
        headings.push(Heading {
            level,
            text: normalized_text.to_string(),
            id: heading_id.clone(),
        });

        output.push_str(&format!(
            "<h{level} id=\"{heading_id}\">{body_html}</h{level}>"
        ));
        last_index = whole.end();
    }

    output.push_str(&html[last_index..]);

    (output, headings)
}

fn slugify(text: &str) -> String {
    let mut slug = String::with_capacity(text.len());
    let mut prev_hyphen = false;

    for ch in text.chars() {
        if ch.is_alphanumeric() {
            for low in ch.to_lowercase() {
                slug.push(low);
            }
            prev_hyphen = false;
        } else if !prev_hyphen {
            slug.push('-');
            prev_hyphen = true;
        }
    }

    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "section".to_string()
    } else {
        trimmed
    }
}
