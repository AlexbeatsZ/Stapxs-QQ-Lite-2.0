const URL_PROTOCOL = /^[a-z][a-z\d+.-]*:\/\//i
const DUMMY_PROTOCOL = 'ws://'

function normalizeHostname(hostname: string) {
    const trimmed = hostname.trim()
    if (trimmed.includes(':') && !trimmed.startsWith('[')) {
        return `[${trimmed}]`
    }
    return trimmed
}

/**
 * Replace only the hostname in a configured connection address.
 *
 * The protocol, port, path, query, and hash stay unchanged so the stored
 * address remains a usable fallback when following the page host is disabled.
 */
export function followPageHostname(address: string, pageHostname: string) {
    const hostname = normalizeHostname(pageHostname)
    if (!address || !hostname) return address

    const hasProtocol = URL_PROTOCOL.test(address)
    try {
        const parsed = new URL(hasProtocol ? address : DUMMY_PROTOCOL + address)
        parsed.hostname = hostname
        const resolved = parsed.toString()
        return hasProtocol ? resolved : resolved.slice(DUMMY_PROTOCOL.length)
    } catch (e) {
        if (e instanceof TypeError) return address
        throw e
    }
}
