package com.michael.markdownviewer

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.enableEdgeToEdge
import java.io.File
import java.io.FileOutputStream
import java.util.Locale

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    persistLaunchPathFromIntent(intent)
    super.onCreate(savedInstanceState)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    persistLaunchPathFromIntent(intent)
  }

  private fun persistLaunchPathFromIntent(intent: Intent?): Boolean {
    val markdownFile = extractMarkdownFile(intent) ?: return false
    return try {
      val markerFile = File(cacheDir, LAUNCH_MARKER_FILE)
      markerFile.writeText(markdownFile.absolutePath, Charsets.UTF_8)
      Log.i(LOG_TAG, "Intent markdown cached: ${markdownFile.absolutePath}")
      true
    } catch (err: Exception) {
      Log.w(LOG_TAG, "Failed to persist launch marker", err)
      false
    }
  }

  private fun extractMarkdownFile(intent: Intent?): File? {
    if (intent == null) {
      return null
    }

    val action = intent.action ?: return null
    val uri = when (action) {
      Intent.ACTION_VIEW -> intent.data
      Intent.ACTION_SEND -> getSendStreamUri(intent)
      else -> null
    } ?: return null

    return when (uri.scheme?.lowercase(Locale.ROOT)) {
      "file" -> fromFileUri(uri)
      "content" -> copyUriToCache(uri)
      else -> null
    }
  }

  private fun fromFileUri(uri: Uri): File? {
    val path = uri.path ?: return null
    val file = File(path)
    if (file.exists() && isMarkdownName(file.name)) {
      return file
    }
    return copyUriToCache(uri)
  }

  private fun copyUriToCache(uri: Uri): File? {
    val displayName = queryDisplayName(uri) ?: uri.lastPathSegment ?: "incoming.md"
    val safeName = sanitizeFileName(displayName)
    val targetName = if (isMarkdownName(safeName)) safeName else "$safeName.md"
    val incomingDir = File(cacheDir, "incoming-markdown").apply { mkdirs() }
    val target = File(incomingDir, "${System.currentTimeMillis()}-$targetName")

    return try {
      contentResolver.openInputStream(uri)?.use { input ->
        FileOutputStream(target).use { output ->
          input.copyTo(output)
        }
      } ?: return null
      target
    } catch (err: Exception) {
      Log.w(LOG_TAG, "Failed to cache markdown uri: $uri", err)
      null
    }
  }

  private fun queryDisplayName(uri: Uri): String? {
    return try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (nameIndex >= 0 && cursor.moveToFirst()) {
          cursor.getString(nameIndex)
        } else {
          null
        }
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun sanitizeFileName(name: String): String {
    val trimmed = name.substringAfterLast('/').substringAfterLast('\\').trim()
    val normalized = if (trimmed.isBlank()) "incoming.md" else trimmed
    return normalized.replace(Regex("[^A-Za-z0-9._-]"), "_")
  }

  private fun isMarkdownName(name: String): Boolean {
    val lower = name.lowercase(Locale.ROOT)
    return lower.endsWith(".md") ||
      lower.endsWith(".markdown") ||
      lower.endsWith(".mdown") ||
      lower.endsWith(".mkd")
  }

  @Suppress("DEPRECATION")
  private fun getSendStreamUri(intent: Intent): Uri? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }
  }

  companion object {
    private const val LOG_TAG = "MdViewer"
    private const val LAUNCH_MARKER_FILE = "external_launch_path.txt"
  }
}
