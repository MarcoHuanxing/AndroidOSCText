package com.aost.bridge

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

/**
 * LAN auto-discovery client, mirroring pc-bridge/src/discovery.js.
 *
 * Broadcasts a small JSON probe to UDP 7713; the bridge answers with its HTTP
 * endpoint. This spares the user from typing an IP that DHCP may have changed.
 *
 * Plain UDP broadcast is used instead of mDNS/NsdManager because NsdManager
 * needs multicast locks on many Android builds and behaves inconsistently
 * across vendors.
 */
class DiscoveryClient {

    data class Endpoint(
        val host: String,
        val port: Int,
        val name: String,
        val version: String,
        val requiresToken: Boolean,
    )

    companion object {
        const val DISCOVERY_PORT = 7713
        private const val MAGIC = "AOST-DISCOVER"
        private const val TIMEOUT_MS = 2500
    }

    /**
     * Broadcast on every local interface and collect whatever answers.
     * Returns a de-duplicated list; empty means nothing responded.
     */
    suspend fun discover(): List<Endpoint> = withContext(Dispatchers.IO) {
        val found = LinkedHashMap<String, Endpoint>()

        val socket = DatagramSocket().apply {
            broadcast = true
            soTimeout = 400 // short: we poll for replies until the deadline
            reuseAddress = true
        }

        try {
            val probe = JSONObject().apply { put("aost", MAGIC) }
                .toString().toByteArray(Charsets.UTF_8)

            // 255.255.255.255 covers most home routers; add the subnet-directed
            // broadcast too because some APs drop the global one.
            val targets = broadcastTargets()

            for (target in targets) {
                try {
                    socket.send(DatagramPacket(probe, probe.size, InetAddress.getByName(target), DISCOVERY_PORT))
                } catch (_: Exception) {
                    // One unreachable interface must not abort the sweep.
                }
            }

            val deadline = System.currentTimeMillis() + TIMEOUT_MS
            val buf = ByteArray(2048)
            while (System.currentTimeMillis() < deadline) {
                val packet = DatagramPacket(buf, buf.size)
                try {
                    socket.receive(packet)
                } catch (_: SocketTimeoutException) {
                    continue // keep polling until the deadline
                }
                parseReply(packet, found)
            }
        } finally {
            try { socket.close() } catch (_: Exception) { }
        }

        found.values.toList()
    }

    private fun parseReply(packet: DatagramPacket, into: MutableMap<String, Endpoint>) {
        try {
            val text = String(packet.data, 0, packet.length, Charsets.UTF_8)
            val json = JSONObject(text)
            if (json.optString("aost") != MAGIC) return

            val port = json.optInt("port", 0)
            if (port <= 0) return

            val host = packet.address?.hostAddress ?: return
            // IPv6-mapped IPv4 comes back as ::ffff:192.168.x.x on some stacks.
            val cleanHost = host.removePrefix("::ffff:")

            val ep = Endpoint(
                host = cleanHost,
                port = port,
                name = json.optString("name", "AndroidOSCText bridge"),
                version = json.optString("version", "?"),
                requiresToken = json.optBoolean("requiresToken", true),
            )
            into[cleanHost + ":" + port] = ep
        } catch (_: Exception) {
            // Malformed or foreign packet: ignore.
        }
    }

    /**
     * Broadcast addresses worth probing. Reads the interface list rather than
     * relying on a single 255.255.255.255, which many access points filter.
     */
    private fun broadcastTargets(): List<String> {
        val out = LinkedHashSet<String>()
        out.add("255.255.255.255")
        try {
            for (iface in java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                if (!iface.isUp || iface.isLoopback) continue
                for (addr in iface.interfaceAddresses) {
                    val b = addr.broadcast ?: continue
                    out.add(b.hostAddress ?: continue)
                }
            }
        } catch (_: Exception) {
            // Fall back to the global broadcast only.
        }
        return out.toList()
    }
}
