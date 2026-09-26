use app_core::{
    AppActivity, AppActivityTarget, MediaPathDataInput, QuranBookmark, QuranCaptureRequest,
    QuranCaptureRequestStatus, QuranPage, QuranProgress, QuranReadingPosition, QuranRecording,
    QuranRecordingOrigin, QuranRecordingQuery, QuranVerseRange, QuranVerseRef,
    ReplaceQuranRecordingRangeInput, SaveQuranBookmarkInput, SaveQuranReadingPositionInput,
    SaveQuranRecordingInput, SaveQuranRecordingReviewInput, StartStandaloneQuranRecordingInput,
};
use data_client::DataClient;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    http::{header, Method, Request as HttpRequest, Response as HttpResponse, StatusCode},
    AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordingTarget {
    origin: QuranRecordingOrigin,
    workflow_id: String,
    node_id: String,
    capture_session_id: String,
    recording_id: String,
    replace_start_ms: Option<i64>,
    surah_number: u16,
    surah_name: String,
    ayah_start: u16,
    end_surah_number: u16,
    end_surah_name: String,
    ayah_end: u16,
}

struct RecordingSession {
    target: RecordingTarget,
    path: PathBuf,
    mime_type: String,
}

struct AppState {
    client: Option<DataClient>,
    config_error: Option<String>,
    initial_target: Mutex<Option<RecordingTarget>>,
    recordings: Mutex<HashMap<String, RecordingSession>>,
    content_root: Option<PathBuf>,
}

#[tauri::command]
async fn ensure_quran_font(page_number: u16, state: State<'_, AppState>) -> Result<String, String> {
    if !(1..=604).contains(&page_number) {
        return Err("Quran page is outside the Mushaf".into());
    }
    let root = state
        .content_root
        .clone()
        .ok_or_else(|| "Quran content storage is unavailable".to_owned())?;
    let directory = root.join("fonts/v2");
    let path = directory.join(format!("p{page_number}.woff2"));
    if !tokio::fs::try_exists(&path)
        .await
        .map_err(|error| error.to_string())?
    {
        tokio::fs::create_dir_all(&directory)
            .await
            .map_err(|error| error.to_string())?;
        let response = reqwest::Client::new()
            .get(format!(
                "https://verses.quran.foundation/fonts/quran/hafs/v2/woff2/p{page_number}.woff2"
            ))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "QCF font download failed with HTTP {}",
                response.status()
            ));
        }
        let bytes = response.bytes().await.map_err(|error| error.to_string())?;
        if bytes.is_empty() || bytes.len() > 4 * 1024 * 1024 {
            return Err("QCF font response is invalid".into());
        }
        let temporary = directory.join(format!("p{page_number}.download"));
        tokio::fs::write(&temporary, bytes)
            .await
            .map_err(|error| error.to_string())?;
        tokio::fs::rename(&temporary, &path)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(format!(
        "quran-content://localhost/fonts/v2/p{page_number}.woff2"
    ))
}

impl Drop for AppState {
    fn drop(&mut self) {
        let Ok(recordings) = self.recordings.lock() else {
            return;
        };
        for session in recordings.values() {
            let _ = std::fs::remove_file(&session.path);
        }
    }
}

impl AppState {
    fn client(&self) -> Result<DataClient, String> {
        self.client.clone().ok_or_else(|| {
            self.config_error
                .clone()
                .unwrap_or_else(|| "data service is unavailable".into())
        })
    }
}

#[tauri::command]
fn initial_target(state: State<'_, AppState>) -> Option<RecordingTarget> {
    state.initial_target.lock().ok()?.clone()
}

fn recording_target_from_request(request: QuranCaptureRequest) -> RecordingTarget {
    RecordingTarget {
        origin: QuranRecordingOrigin::Workflow,
        workflow_id: request.workflow_id,
        node_id: request.node_id,
        capture_session_id: request.id,
        recording_id: request.recording_id,
        replace_start_ms: request.replace_start_ms,
        surah_number: request.surah_number,
        surah_name: request.surah_name.clone(),
        ayah_start: request.ayah_start,
        end_surah_number: request.end_surah_number,
        end_surah_name: request.end_surah_name,
        ayah_end: request.ayah_end,
    }
}

#[tauri::command]
async fn get_quran_page(
    page_number: u16,
    refresh: Option<bool>,
    state: State<'_, AppState>,
) -> Result<QuranPage, String> {
    state
        .client()?
        .quran_page(page_number, refresh.unwrap_or(false))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_quran_verse_page(
    reference: QuranVerseRef,
    state: State<'_, AppState>,
) -> Result<u16, String> {
    state
        .client()?
        .quran_verse_page(reference)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_quran_progress(state: State<'_, AppState>) -> Result<QuranProgress, String> {
    state
        .client()?
        .quran_progress()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_standalone_recitation(
    range: QuranVerseRange,
    start_surah_name: String,
    end_surah_name: String,
    state: State<'_, AppState>,
) -> Result<RecordingTarget, String> {
    if !range.is_valid() {
        return Err("recitation range is invalid".into());
    }
    let id = uuid::Uuid::now_v7().to_string();
    let session_id = uuid::Uuid::now_v7().to_string();
    let recording = state
        .client()?
        .start_standalone_quran_recording(StartStandaloneQuranRecordingInput {
            id: id.clone(),
            session_id: session_id.clone(),
            range: range.clone(),
            start_surah_name: start_surah_name.clone(),
            end_surah_name: end_surah_name.clone(),
        })
        .await
        .map_err(|error| error.to_string())?;
    Ok(RecordingTarget {
        origin: QuranRecordingOrigin::Standalone,
        workflow_id: String::new(),
        node_id: String::new(),
        capture_session_id: session_id,
        recording_id: recording.id,
        replace_start_ms: Some(0),
        surah_number: range.start.surah_number,
        surah_name: start_surah_name,
        ayah_start: range.start.ayah_number,
        end_surah_number: range.end.surah_number,
        end_surah_name,
        ayah_end: range.end.ayah_number,
    })
}

#[tauri::command]
async fn save_recitation_review(
    input: SaveQuranRecordingReviewInput,
    state: State<'_, AppState>,
) -> Result<QuranRecording, String> {
    state
        .client()?
        .save_quran_recording_review(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn pause_capture_activity(
    capture_session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let request = state
        .client()?
        .quran_capture_request(capture_session_id.clone())
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Quran capture request does not exist".to_owned())?;
    if !matches!(
        request.status,
        QuranCaptureRequestStatus::Completed
            | QuranCaptureRequestStatus::Cancelled
            | QuranCaptureRequestStatus::Failed
    ) {
        state
            .client()?
            .set_quran_capture_request_status(capture_session_id, QuranCaptureRequestStatus::Paused)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn get_capture_request(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<RecordingTarget>, String> {
    state
        .client()?
        .quran_capture_request(id)
        .await
        .map(|value| value.map(recording_target_from_request))
        .map_err(|error| error.to_string())
}

fn extension_for(mime_type: &str) -> &'static str {
    if mime_type.contains("mp4") || mime_type.contains("m4a") {
        "m4a"
    } else if mime_type.contains("ogg") {
        "ogg"
    } else {
        "webm"
    }
}

#[tauri::command]
async fn begin_recording(
    target: RecordingTarget,
    mime_type: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if target.capture_session_id.is_empty()
        || target.recording_id.is_empty()
        || (target.origin == QuranRecordingOrigin::Workflow
            && (target.workflow_id.is_empty() || target.node_id.is_empty()))
        || target.replace_start_ms.is_some_and(|value| value < 0)
    {
        return Err("recording target is incomplete".into());
    }
    let range = QuranVerseRange {
        start: QuranVerseRef {
            surah_number: target.surah_number,
            ayah_number: target.ayah_start,
        },
        end: QuranVerseRef {
            surah_number: target.end_surah_number,
            ayah_number: target.ayah_end,
        },
    };
    if !range.is_valid() {
        return Err("recording target has an invalid Surah or ayah range".into());
    }
    if target.origin == QuranRecordingOrigin::Workflow {
        let workflow = state
            .client()?
            .get_canvas(target.workflow_id.clone())
            .await
            .map_err(|error| error.to_string())?;
        if !matches!(workflow, Some(ref document) if document.summary.canvas_type == app_core::CanvasType::Workflow)
        {
            return Err("workflow does not exist".into());
        }
        state
            .client()?
            .set_quran_capture_request_status(
                target.capture_session_id.clone(),
                QuranCaptureRequestStatus::Recording,
            )
            .await
            .map_err(|error| error.to_string())?;
    }
    let safe_session: String = target
        .capture_session_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect();
    let path = std::env::temp_dir().join(format!(
        "quran-{}-{}-{}-{}.{}",
        target.surah_number,
        target.ayah_start,
        target.ayah_end,
        safe_session,
        extension_for(&mime_type),
    ));
    tokio::fs::File::create(&path)
        .await
        .map_err(|error| error.to_string())?;
    state
        .recordings
        .lock()
        .map_err(|_| "recording lock failed")?
        .insert(
            target.capture_session_id.clone(),
            RecordingSession {
                target,
                path,
                mime_type,
            },
        );
    Ok(())
}

#[tauri::command]
async fn append_recording_chunk(
    capture_session_id: String,
    bytes: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if bytes.is_empty() {
        return Ok(());
    }
    let path = state
        .recordings
        .lock()
        .map_err(|_| "recording lock failed")?
        .get(&capture_session_id)
        .map(|session| session.path.clone())
        .ok_or_else(|| "recording session does not exist".to_owned())?;
    let mut file = tokio::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .await
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes)
        .await
        .map_err(|error| error.to_string())?;
    file.flush().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn finish_recording(
    capture_session_id: String,
    duration_ms: i64,
    waveform_peaks: Vec<f32>,
    state: State<'_, AppState>,
) -> Result<QuranRecording, String> {
    let session = state
        .recordings
        .lock()
        .map_err(|_| "recording lock failed")?
        .remove(&capture_session_id)
        .ok_or_else(|| "recording session does not exist".to_owned())?;
    let client = state.client()?;
    let imported = client
        .import_media_path_data(MediaPathDataInput {
            canvas_id: if session.target.origin == QuranRecordingOrigin::Workflow {
                session.target.workflow_id.clone()
            } else {
                "quran-recordings-library".into()
            },
            source_path: session.path.to_string_lossy().into_owned(),
            original_name: format!(
                "{} {}-{} recitation.{}",
                session.target.surah_name,
                session.target.ayah_start,
                session.target.ayah_end,
                extension_for(&session.mime_type)
            ),
            mime_type: session.mime_type,
        })
        .await
        .map_err(|error| error.to_string());
    let _ = tokio::fs::remove_file(&session.path).await;
    let imported = imported?;
    let newly_imported = imported.imported.first().is_some();
    let media = imported
        .imported
        .first()
        .or_else(|| imported.duplicates.first())
        .ok_or_else(|| {
            imported
                .failures
                .first()
                .map(|failure| failure.message.clone())
                .unwrap_or_else(|| "recording import failed".into())
        })?;
    let capture_request_id = session.target.capture_session_id.clone();
    let result = if session.target.origin == QuranRecordingOrigin::Standalone
        || session.target.replace_start_ms.is_some()
    {
        client
            .replace_quran_recording_range(ReplaceQuranRecordingRangeInput {
                recording_id: session.target.recording_id,
                media_id: media.id.clone(),
                start_ms: session.target.replace_start_ms.unwrap_or(0),
                duration_ms: duration_ms.max(0),
                waveform_peaks,
            })
            .await
            .map(|mutation| mutation)
    } else {
        client
            .save_quran_recording(SaveQuranRecordingInput {
                id: session.target.recording_id,
                session_id: capture_request_id.clone(),
                workflow_id: session.target.workflow_id,
                node_id: session.target.node_id,
                media_id: media.id.clone(),
                surah_number: session.target.surah_number,
                surah_name: session.target.surah_name,
                ayah_start: session.target.ayah_start,
                ayah_end: session.target.ayah_end,
                duration_ms: duration_ms.max(0),
                waveform_peaks,
            })
            .await
            .map(|recording| app_core::QuranRecordingMutation {
                recording,
                orphaned_media_ids: Vec::new(),
            })
    };
    match result {
        Ok(mutation) => {
            for orphaned_media_id in mutation.orphaned_media_ids {
                let _ = client.delete_media(orphaned_media_id).await;
            }
            if session.target.origin == QuranRecordingOrigin::Workflow {
                client
                    .set_quran_capture_request_status(
                        capture_request_id.clone(),
                        QuranCaptureRequestStatus::Ready,
                    )
                    .await
                    .map_err(|error| error.to_string())?;
            }
            Ok(mutation.recording)
        }
        Err(error) => {
            if newly_imported {
                let _ = client.delete_media(media.id.clone()).await;
            }
            if session.target.origin == QuranRecordingOrigin::Workflow {
                let _ = client
                    .set_quran_capture_request_status(
                        capture_request_id,
                        QuranCaptureRequestStatus::Failed,
                    )
                    .await;
            }
            Err(error.to_string())
        }
    }
}

#[tauri::command]
async fn discard_recording(
    capture_session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .recordings
        .lock()
        .map_err(|_| "recording lock failed")?
        .remove(&capture_session_id);
    if let Some(session) = session {
        let _ = tokio::fs::remove_file(session.path).await;
        let _ = state
            .client()?
            .set_quran_capture_request_status(
                capture_session_id,
                QuranCaptureRequestStatus::Cancelled,
            )
            .await;
    }
    Ok(())
}

#[tauri::command]
async fn list_recordings(state: State<'_, AppState>) -> Result<Vec<QuranRecording>, String> {
    state
        .client()?
        .list_quran_recordings(QuranRecordingQuery::default())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn delete_recording(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let client = state.client()?;
    let media_ids = client
        .delete_quran_recording(id)
        .await
        .map_err(|error| error.to_string())?;
    if media_ids.is_empty() {
        return Ok(false);
    }
    for media_id in media_ids {
        let _ = client.delete_media(media_id).await;
    }
    Ok(true)
}

#[tauri::command]
async fn list_bookmarks(state: State<'_, AppState>) -> Result<Vec<QuranBookmark>, String> {
    state
        .client()?
        .list_quran_bookmarks()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_bookmark(
    input: SaveQuranBookmarkInput,
    state: State<'_, AppState>,
) -> Result<QuranBookmark, String> {
    state
        .client()?
        .save_quran_bookmark(input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn delete_bookmark(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    state
        .client()?
        .delete_quran_bookmark(id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_reading_position(
    state: State<'_, AppState>,
) -> Result<Option<QuranReadingPosition>, String> {
    state
        .client()?
        .quran_reading_position()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_reading_position(
    input: SaveQuranReadingPositionInput,
    state: State<'_, AppState>,
) -> Result<QuranReadingPosition, String> {
    state
        .client()?
        .save_quran_reading_position(input)
        .await
        .map_err(|error| error.to_string())
}

fn safe_media_path(root: &Path, key: &str) -> Result<PathBuf, String> {
    let relative = Path::new(key);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("invalid media storage key".into());
    }
    let root = std::fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path = std::fs::canonicalize(root.join(relative)).map_err(|error| error.to_string())?;
    path.starts_with(&root)
        .then_some(path)
        .ok_or_else(|| "media path escapes storage root".into())
}

fn response(status: StatusCode, content_type: &str, body: Vec<u8>) -> HttpResponse<Vec<u8>> {
    HttpResponse::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap()
}

fn quran_content_response(
    root: Option<PathBuf>,
    request: HttpRequest<Vec<u8>>,
) -> HttpResponse<Vec<u8>> {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return response(StatusCode::METHOD_NOT_ALLOWED, "text/plain", Vec::new());
    }
    let path = request.uri().path().trim_start_matches('/');
    let Some(page) = path
        .strip_prefix("fonts/v2/p")
        .and_then(|value| value.strip_suffix(".woff2"))
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| (1..=604).contains(value))
    else {
        return response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    };
    let Some(root) = root else {
        return response(StatusCode::SERVICE_UNAVAILABLE, "text/plain", Vec::new());
    };
    let Ok(bytes) = std::fs::read(root.join("fonts/v2").join(format!("p{page}.woff2"))) else {
        return response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
    };
    response(
        StatusCode::OK,
        "font/woff2",
        if request.method() == Method::HEAD {
            Vec::new()
        } else {
            bytes
        },
    )
}

fn recording_media_response(
    client: DataClient,
    media_root: PathBuf,
    request: HttpRequest<Vec<u8>>,
) -> HttpResponse<Vec<u8>> {
    let id = request
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or_default()
        .to_owned();
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return response(StatusCode::METHOD_NOT_ALLOWED, "text/plain", Vec::new());
    }
    let allowed = tauri::async_runtime::block_on(
        client.list_quran_recordings(QuranRecordingQuery::default()),
    )
    .map(|recordings| {
        recordings.iter().any(|recording| {
            recording
                .segments
                .iter()
                .any(|segment| segment.media_id == id)
        })
    })
    .unwrap_or(false);
    if !allowed {
        return response(
            StatusCode::NOT_FOUND,
            "text/plain",
            b"recording not found".to_vec(),
        );
    }
    let storage = match tauri::async_runtime::block_on(client.get_media_storage(id)) {
        Ok(Some(storage)) => storage,
        _ => {
            return response(
                StatusCode::NOT_FOUND,
                "text/plain",
                b"recording not found".to_vec(),
            )
        }
    };
    let path = match safe_media_path(&media_root, &storage.storage_key) {
        Ok(path) => path,
        Err(_) => {
            return response(
                StatusCode::NOT_FOUND,
                "text/plain",
                b"recording not found".to_vec(),
            )
        }
    };
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => {
            return response(
                StatusCode::NOT_FOUND,
                "text/plain",
                b"recording not found".to_vec(),
            )
        }
    };
    let size = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_range(value, size));
    let (status, start, end) = match (request.headers().contains_key(header::RANGE), range) {
        (true, Some(range)) => (StatusCode::PARTIAL_CONTENT, range.0, range.1),
        (true, None) => {
            return HttpResponse::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Vec::new())
                .unwrap()
        }
        (false, _) => (StatusCode::OK, 0, size.saturating_sub(1)),
    };
    let length = if size == 0 { 0 } else { end - start + 1 };
    let mut body = Vec::new();
    if *request.method() != Method::HEAD && length > 0 {
        if file.seek(SeekFrom::Start(start)).is_err()
            || file.take(length).read_to_end(&mut body).is_err()
        {
            return response(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", Vec::new());
        }
    }
    let mut builder = HttpResponse::builder()
        .status(status)
        .header(header::CONTENT_TYPE, storage.mime_type)
        .header(header::CONTENT_LENGTH, length.to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    builder.body(body).unwrap()
}

fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    if value.contains(',') || size == 0 {
        return None;
    }
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(size);
        return Some((size - suffix, size - 1));
    }
    let start = start.parse::<u64>().ok()?;
    if start >= size {
        return None;
    }
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().ok()?.min(size - 1)
    };
    (start <= end).then_some((start, end))
}

fn argument(arguments: &[String], key: &str) -> Option<String> {
    arguments
        .iter()
        .position(|value| value == key)
        .and_then(|index| arguments.get(index + 1))
        .cloned()
}

fn target_from_arguments(arguments: &[String]) -> Option<RecordingTarget> {
    Some(RecordingTarget {
        origin: QuranRecordingOrigin::Workflow,
        workflow_id: argument(arguments, "--workflow-id")?,
        node_id: argument(arguments, "--node-id")?,
        capture_session_id: argument(arguments, "--capture-session-id")?,
        recording_id: argument(arguments, "--recording-id")?,
        replace_start_ms: argument(arguments, "--replace-start-ms")
            .and_then(|value| value.parse().ok()),
        surah_number: argument(arguments, "--surah-number")?.parse().ok()?,
        surah_name: argument(arguments, "--surah-name")?,
        ayah_start: argument(arguments, "--ayah-start")?.parse().ok()?,
        end_surah_number: argument(arguments, "--surah-number")?.parse().ok()?,
        end_surah_name: argument(arguments, "--surah-name")?,
        ayah_end: argument(arguments, "--ayah-end")?.parse().ok()?,
    })
}

fn capture_window_label(id: &str) -> String {
    format!(
        "capture-{}",
        id.chars()
            .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
            .collect::<String>()
    )
}

fn show_quran_main(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Quran main window is unavailable".to_owned())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn show_capture_window(app: &AppHandle, id: &str) -> Result<(), String> {
    let label = capture_window_label(id);
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("index.html?captureRequestId={id}").into()),
    )
    .title("Recitation — Quran")
    .inner_size(900.0, 760.0)
    .min_inner_size(760.0, 640.0)
    .center()
    .decorations(true)
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

async fn handle_quran_activity(app: AppHandle, activity: AppActivity) -> Result<(), String> {
    let AppActivity::QuranCapture { capture_request_id } = activity else {
        return Err("activity is not handled by Quran".into());
    };
    let request = app
        .state::<AppState>()
        .client()?
        .quran_capture_request(capture_request_id.clone())
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Quran capture request does not exist".to_owned())?;
    if matches!(
        request.status,
        QuranCaptureRequestStatus::Saved
            | QuranCaptureRequestStatus::Completed
            | QuranCaptureRequestStatus::Cancelled
            | QuranCaptureRequestStatus::Failed
    ) {
        return Err("Quran capture request is already closed".into());
    }
    show_capture_window(&app, &capture_request_id)
}

fn dispatch_quran_urls(app: &AppHandle, values: impl IntoIterator<Item = String>) -> bool {
    let activities: Vec<_> = values
        .into_iter()
        .filter_map(|value| AppActivity::parse_url(&value))
        .filter(|activity| activity.target() == AppActivityTarget::Quran)
        .collect();
    let handled = !activities.is_empty();
    for activity in activities {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = handle_quran_activity(app, activity).await;
        });
    }
    handled
}

fn start_development_activity_host(app: AppHandle, client: DataClient) {
    let instance_id = uuid::Uuid::now_v7().to_string();
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = client
                .register_app_activity_host(AppActivityTarget::Quran, instance_id.clone())
                .await;
            if let Ok(activities) = client
                .claim_app_activities(AppActivityTarget::Quran, instance_id.clone())
                .await
            {
                for envelope in activities {
                    let succeeded = handle_quran_activity(app.clone(), envelope.activity)
                        .await
                        .is_ok();
                    let _ = client
                        .ack_app_activity(envelope.id, instance_id.clone(), succeeded)
                        .await;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (client, media_root, config_error) = match app_config::ProductivityConfig::load() {
        Ok(config) => {
            let settings = config.service_settings();
            (
                Some(DataClient::new(
                    &settings.socket_path,
                    settings.max_request_bytes,
                )),
                Some(PathBuf::from(settings.media_path)),
                None,
            )
        }
        Err(error) => (None, None, Some(error.to_string())),
    };
    let arguments: Vec<String> = std::env::args().collect();
    let legacy_target = target_from_arguments(&arguments);
    let activity_host = arguments.iter().any(|value| value == "--activity-host");
    let protocol_client = client.clone();
    let managed_client = client.clone();
    let content_root = media_root.as_ref().map(|root| root.join("quran-content"));
    let protocol_content_root = content_root.clone();
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            dispatch_quran_urls(app, args);
        }));
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState {
            client,
            config_error,
            initial_target: Mutex::new(legacy_target.clone()),
            recordings: Mutex::new(HashMap::new()),
            content_root,
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let mut handled = false;
            if let Some(urls) = app.deep_link().get_current()? {
                handled = dispatch_quran_urls(&handle, urls.into_iter().map(|url| url.to_string()));
            }
            let event_handle = handle.clone();
            app.deep_link().on_open_url(move |event| {
                dispatch_quran_urls(&event_handle, event.urls().iter().map(ToString::to_string));
            });
            if activity_host {
                if let Some(client) = managed_client.clone() {
                    start_development_activity_host(handle, client);
                }
            } else if !handled {
                show_quran_main(&handle).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol(
            "quran-media",
            move |_context, request, responder| {
                let client = protocol_client.clone();
                let media_root = media_root.clone();
                std::thread::spawn(move || {
                    let response = match (client, media_root) {
                        (Some(client), Some(media_root)) => {
                            recording_media_response(client, media_root, request)
                        }
                        _ => response(
                            StatusCode::SERVICE_UNAVAILABLE,
                            "text/plain",
                            b"media service unavailable".to_vec(),
                        ),
                    };
                    responder.respond(response);
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "quran-content",
            move |_context, request, responder| {
                let root = protocol_content_root.clone();
                std::thread::spawn(move || {
                    responder.respond(quran_content_response(root, request))
                });
            },
        )
        .invoke_handler(tauri::generate_handler![
            initial_target,
            get_capture_request,
            get_quran_page,
            get_quran_verse_page,
            get_quran_progress,
            start_standalone_recitation,
            save_recitation_review,
            pause_capture_activity,
            ensure_quran_font,
            begin_recording,
            append_recording_chunk,
            finish_recording,
            discard_recording,
            list_recordings,
            delete_recording,
            list_bookmarks,
            save_bookmark,
            delete_bookmark,
            get_reading_position,
            save_reading_position,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quran");
}
