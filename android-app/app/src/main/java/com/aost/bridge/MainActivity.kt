package com.aost.bridge

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.inputmethod.EditorInfo
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.aost.bridge.databinding.ActivityMainBinding
import kotlinx.coroutines.launch

/**
 * Single-screen messenger.
 *
 * Layout: a large compose box, a live character counter, send + typing buttons,
 * and a collapsible connection panel.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: Prefs
    private var client: BridgeClient? = null

    private val maxChars = 144
    private val maxLines = 9

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = Prefs(this)

        binding.hostField.setText(prefs.host)
        binding.portField.setText(prefs.port.toString())
        binding.tokenField.setText(prefs.token)
        binding.sfxSwitch.isChecked = prefs.sendSfx
        binding.composeBox.setText(prefs.draft)

        buildClient()

        binding.countLabel.text = getString(R.string.counter_format, 0, maxChars)
        updateSendEnabled()

        binding.composeBox.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = Unit
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                prefs.draft = s?.toString().orEmpty()
                refreshCounter()
            }
        })

        binding.sendButton.setOnClickListener { sendText() }
        binding.typingButton.setOnClickListener { toggleTyping() }
        binding.connectButton.setOnClickListener {
            saveSettings()
            buildClient()
            checkHealth(announce = true)
        }
        binding.discoverButton.setOnClickListener { runDiscovery() }
        binding.settingsToggle.setOnClickListener {
            val showing = binding.settingsPanel.visibility == View.VISIBLE
            binding.settingsPanel.visibility = if (showing) View.GONE else View.VISIBLE
        }

        // Shift+Enter inserts a newline; Enter sends.
        binding.composeBox.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendText()
                true
            } else false
        }

        checkHealth(announce = false)
    }

    private fun buildClient() {
        client = BridgeClient(prefs.host, prefs.port, prefs.token)
    }

    private fun saveSettings() {
        val host = binding.hostField.text.toString().trim()
        val port = binding.portField.text.toString().trim().toIntOrNull() ?: BuildConfig.DEFAULT_PORT
        prefs.host = if (host.isBlank()) BuildConfig.DEFAULT_HOST else host
        prefs.port = port
        prefs.token = binding.tokenField.text.toString().trim()
        prefs.sendSfx = binding.sfxSwitch.isChecked
        client = BridgeClient(prefs.host, prefs.port, prefs.token)
    }

    /** Count code points, matching the bridge's own truncation rule. */
    private fun codePointLength(text: String): Int {
        var count = text.codePointCount(0, text.length)
        return count
    }

    private fun lineCount(text: String): Int =
        if (text.isEmpty()) 1 else text.count { it == '\n' } + 1

    private fun refreshCounter() {
        val text = binding.composeBox.text?.toString().orEmpty()
        val chars = codePointLength(text)
        val lines = lineCount(text)
        val over = chars > maxChars || lines > maxLines
        binding.countLabel.text = if (lines > 1) {
            getString(R.string.counter_lines_format, chars, maxChars, lines, maxLines)
        } else {
            getString(R.string.counter_format, chars, maxChars)
        }
        binding.countLabel.setTextColor(
            if (over) 0xFFF85149.toInt() else 0xFF8A93A6.toInt()
        )
        updateSendEnabled()
    }

    private fun updateSendEnabled() {
        val text = binding.composeBox.text?.toString().orEmpty()
        val chars = codePointLength(text)
        val lines = lineCount(text)
        binding.sendButton.isEnabled = chars in 1..maxChars && lines <= maxLines
    }

    private fun checkHealth(announce: Boolean) {
        val c = client ?: return
        binding.statusLabel.text = getString(R.string.status_checking)
        lifecycleScope.launch {
            val r = c.health()
            if (r.ok) {
                binding.statusLabel.text = getString(R.string.status_connected_config, prefs.host, prefs.port)
                binding.statusLabel.setTextColor(0xFF3FB950.toInt())
                if (announce) toast(getString(R.string.toast_connected))
            } else {
                binding.statusLabel.text = getString(R.string.status_failed, r.error ?: "?")
                binding.statusLabel.setTextColor(0xFFF85149.toInt())
                if (announce) toast(getString(R.string.toast_failed, r.error ?: "?"))
            }
        }
    }

    /**
     * Broadcast for a bridge on the LAN and fill in the connection fields.
     * Keeps whatever the user typed if nothing answers.
     */
    private fun runDiscovery() {
        saveSettings()
        binding.discoverButton.isEnabled = false
        binding.statusLabel.text = getString(R.string.discovering)
        binding.statusLabel.setTextColor(0xFF8A93A6.toInt())

        lifecycleScope.launch {
            val found = try {
                DiscoveryClient().discover()
            } catch (e: Exception) {
                emptyList()
            }

            binding.discoverButton.isEnabled = true

            if (found.isEmpty()) {
                binding.statusLabel.text = getString(R.string.discover_none)
                binding.statusLabel.setTextColor(0xFFF85149.toInt())
                return@launch
            }

            val best = found.first()
            binding.hostField.setText(best.host)
            binding.portField.setText(best.port.toString())
            prefs.host = best.host
            prefs.port = best.port
            buildClient()

            binding.statusLabel.text = getString(R.string.discover_found, found.size, best.host + ":" + best.port)
            binding.statusLabel.setTextColor(0xFF3FB950.toInt())

            checkHealth(announce = true)
        }
    }
    private fun sendText() {
        val c = client ?: return
        val text = binding.composeBox.text?.toString().orEmpty()
        if (text.isBlank()) return

        saveSettings()
        binding.sendButton.isEnabled = false
        binding.statusLabel.text = getString(R.string.status_sending)

        lifecycleScope.launch {
            val r = c.say(text, binding.sfxSwitch.isChecked)
            if (r.ok) {
                binding.composeBox.setText("")
                binding.statusLabel.text = getString(R.string.status_sent)
                binding.statusLabel.setTextColor(0xFF3FB950.toInt())
                appendLog(r.body)
                refreshCounter()
            } else {
                binding.statusLabel.text = getString(R.string.status_failed, r.error ?: "?")
                binding.statusLabel.setTextColor(0xFFF85149.toInt())
                updateSendEnabled()
            }
        }
    }

    private fun toggleTyping() {
        val c = client ?: return
        lifecycleScope.launch {
            val r = c.setTyping(true)
            toast(if (r.ok) getString(R.string.toast_typing_on) else getString(R.string.toast_failed, r.error ?: "?"))
        }
    }

    private fun appendLog(line: String) {
        val current = binding.logLabel.text?.toString().orEmpty()
        val combined = if (current.isBlank()) line else line + "\n" + current
        binding.logLabel.text = combined.lines().take(30).joinToString("\n")
    }

    private fun toast(message: String) {
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()
    }
}
