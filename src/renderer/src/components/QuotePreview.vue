<template>
    <div ref="preview" :class="['msg-replay', { me: isMe }]" role="button"
        tabindex="0"
        :aria-label="$t('查看引用消息')" @click.stop="activate" @keydown.enter.stop.prevent="activate"
        @keydown.space.stop.prevent="activate">
        <div v-if="original && !original.revoke">
            <span>{{ original.sender.card || original.sender.nickname }} {{ time }}</span>
            <font-awesome-icon :icon="['fas', 'turn-up']" />
        </div>
        <span v-if="original?.revoke" class="msg-unknown">{{ $t('消息已撤回') }}</span>
        <MsgBody v-else-if="body" :data="body" type="body"
            :global-me="isMe ? 'Y' : ''"
            :id-prefix="`quote-preview-${sourceId}-`" />
        <span v-else-if="original" class="quote-summary">{{ getMsgRawTxt(original) || $t('空消息') }}</span>
        <span v-else class="msg-unknown" aria-live="polite">
            {{ state?.status === 'loading' ? $t('正在加载引用消息……') :
                state?.status === 'error' ? $t('原消息暂不可用，点击重试') : $t('（查看回复消息）') }}
        </span>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import MsgBody from './MsgBody.vue'
import { i18n } from '@renderer/main'
import { useQuotedMessagesStore } from '@renderer/state/quotedMessages'
import { useChatStore } from '@renderer/state/chat'
import { getMsgRawTxt } from '@renderer/function/utils/msgUtil'
import { quotePreviewMessage } from '@renderer/function/utils/quotedMessage'
import { getTrueLang, getViewTime } from '@renderer/function/utils/systemUtil'

defineOptions({ name: 'QuotePreview' })
const props = defineProps<{
    messageId: string | number
    sourceId: string | number
    isMe: boolean
    remote: boolean
}>()
const emit = defineEmits<{ scrollToMsg: [id: string] }>()
const $t = i18n.global.t
const quotes = useQuotedMessagesStore()
const chatStore = useChatStore()
const preview = ref<HTMLElement | null>(null)
const visible = ref(false)
const state = computed(() => props.remote ? quotes.entry(props.messageId) : undefined)
const original = computed(() => state.value?.message ??
    chatStore.messageList.find(message => String(message.message_id) === String(props.messageId) &&
        Array.isArray(message.message) && message.sender))
const body = computed(() => quotePreviewMessage(original.value))
const time = computed(() => original.value && !original.value.revoke ?new Intl.DateTimeFormat(getTrueLang(), { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
        .format(getViewTime(Number(original.value.time))) : '')
let observer: IntersectionObserver | undefined

function prefetch() {
    if (props.remote && visible.value && quotes.canRequest && !original.value) {
        void quotes.load(props.messageId)
    }
}

function activate() {
    const targetId = 'chat-' + props.messageId
    const target = document.getElementById(targetId)
    if (target && document.getElementById('msgPan')?.contains(target)) {
        emit('scrollToMsg', targetId)
    } else if (props.remote) {
        quotes.open(props.messageId)
    }
}

watch(() => [props.messageId, quotes.scopeVersion, quotes.canRequest, visible.value], prefetch)
onMounted(() => {
    if (typeof IntersectionObserver === 'undefined') {
        visible.value = true
        return
    }
    observer = new IntersectionObserver(entries => {
        visible.value = entries.some(entry => entry.isIntersecting)
    })
    if (preview.value) observer.observe(preview.value)
})
onUnmounted(() => observer?.disconnect())
</script>

<style scoped>
.msg-replay:focus-visible { outline: 2px solid var(--color-main); outline-offset: 2px; }
.quote-summary { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.msg-replay :deep(.body-only) { max-height: 160px; overflow: hidden; }
</style>
