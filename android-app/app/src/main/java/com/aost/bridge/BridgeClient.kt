package com.aost.bridge

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * HTTP client for the PC bridge.
 *
 * Endpoints (see pc-bridge/src/server.js):
 *   GET  /api/health
 *   GET  /api/info
 *   POST /api/say     { "text": "...", "sfx": true }
 *   POST /api/typing  { "on": true }
 */
class BridgeClient(var host: String, var port: Int, var token: String) {

    data class Result(val ok: Boolean, val body: String, val error: String? = null)

    private fun baseUrl() = "http://$host:$port"

    private suspend fun request(
        method: String,
        path: String,
        jsonBody: String? = null,
        timeoutMs: Int = 6000
    ): Result = withContext(Dispatchers.IO) {
        var conn: HttpURLConnection? = null
        try {
            val url = URL(baseUrl() + path)
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                if (token.isNotBlank()) {
                    setRequestProperty("Authorization", "Bearer $token")
                }
                if (jsonBody != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
            }
            if (jsonBody != null) {
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(jsonBody) }
            }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (code in 200..299) Result(true, body)
            else Result(false, body, parseError(body) ?: "HTTP $code")
        } catch (e: Exception) {
            Result(false, "", e.message ?: e.javaClass.simpleName)
        } finally {
            conn?.disconnect()
        }
    }

    private fun parseError(body: String): String? = try {
        JSONObject(body).optString("error").ifBlank { null }
    } catch (e: Exception) {
        null
    }

    suspend fun health(): Result = request("GET", "/api/health")

    suspend fun info(): Result = request("GET", "/api/info")

    /** Send text to the VRChat chatbox. Returns the normalised text the bridge used. */
    suspend fun say(text: String, sfx: Boolean = true): Result {
        val payload = JSONObject().apply {
            put("text", text)
            put("sfx", sfx)
        }
        val r = request("POST", "/api/say", payload.toString())
        return if (r.ok) {
            val used = try { JSONObject(r.body).optString("text", text) } catch (e: Exception) { text }
            Result(true, used)
        } else r
    }

    suspend fun setTyping(on: Boolean): Result {
        val payload = JSONObject().apply { put("on", on) }
        return request("POST", "/api/typing", payload.toString())
    }
}
