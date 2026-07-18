import type {
    UserFriendElem,
    UserGroupElem,
} from '../elements/information'

export type SessionContact = UserFriendElem & UserGroupElem

export function getSessionId(item: SessionContact) {
    return Number(item.user_id ?? item.group_id)
}

export function findSessionContact(
    contacts: SessionContact[],
    sessionId: number,
) {
    return contacts.find((item) => {
        return getSessionId(item) === sessionId
    })
}

export function resolveIncomingSession(
    contacts: SessionContact[],
    sessionId: number,
    isGroup: boolean,
    senderName?: string,
) {
    const contact = findSessionContact(contacts, sessionId)
    if (contact) return contact

    // 消息事件可能早于好友/群列表返回。先保留会话动态状态，列表加载后再合并真实资料。
    if (isGroup) {
        return {
            group_id: sessionId,
            group_name: String(sessionId),
        } as SessionContact
    }
    return {
        user_id: sessionId,
        nickname: senderName || String(sessionId),
        remark: '',
    } as SessionContact
}

const SESSION_STATE_KEYS = [
    'new_msg',
    'raw_msg',
    'raw_msg_base',
    'time',
    'always_top',
    'message_id',
    'highlight',
] as const

export function mergeSessionState(
    contact: SessionContact,
    currentSession: SessionContact,
) {
    const contactRecord = contact as unknown as Record<string, unknown>
    const sessionRecord = currentSession as unknown as Record<string, unknown>
    SESSION_STATE_KEYS.forEach((key) => {
        if (sessionRecord[key] !== undefined) {
            contactRecord[key] = sessionRecord[key]
        }
    })
    return contact
}
