package com.aost.bridge

import android.content.Context
import android.content.SharedPreferences

/**
 * Persisted connection settings.
 *
 * Talks to plain SharedPreferences so the app has zero third-party deps.
 */
class Prefs(context: Context) {

    private val sp: SharedPreferences =
        context.getSharedPreferences("aost", Context.MODE_PRIVATE)

    var host: String
        get() = sp.getString(KEY_HOST, BuildConfig.DEFAULT_HOST) ?: BuildConfig.DEFAULT_HOST
        set(v) = sp.edit().putString(KEY_HOST, v).apply()

    var port: Int
        get() = sp.getInt(KEY_PORT, BuildConfig.DEFAULT_PORT)
        set(v) = sp.edit().putInt(KEY_PORT, v).apply()

    var token: String
        get() = sp.getString(KEY_TOKEN, "") ?: ""
        set(v) = sp.edit().putString(KEY_TOKEN, v).apply()

    var sendSfx: Boolean
        get() = sp.getBoolean(KEY_SFX, true)
        set(v) = sp.edit().putBoolean(KEY_SFX, v).apply()

    /** The text currently in the compose box, restored after a rotation or process death. */
    var draft: String
        get() = sp.getString(KEY_DRAFT, "") ?: ""
        set(v) = sp.edit().putString(KEY_DRAFT, v).apply()

    private companion object {
        const val KEY_HOST = "host"
        const val KEY_PORT = "port"
        const val KEY_TOKEN = "token"
        const val KEY_SFX = "sfx"
        const val KEY_DRAFT = "draft"
    }
}
