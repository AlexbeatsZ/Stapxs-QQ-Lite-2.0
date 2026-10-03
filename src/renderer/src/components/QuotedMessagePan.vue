<template>
    <Teleport to="body">
        <div v-if="quotes.viewerId !== null" class="quote-overlay">
            <button type="button" class="quote-backdrop" :aria-label="$t('关闭')"
                tabindex="-1" @click="quotes.close" />
            <dialog ref="panel" class="quote-panel ss-card" open
                aria-modal="true"
                aria-labelledby="quote-title" tabindex="-1" @keydown="onKeydown">
                <header>
                    <h2 id="quote-title">
                        {{ $t('引用消息') }}
                    </h2>
                    <button type="button" :aria-label="$t('关闭')" @click="quotes.close">
                        <font-awesome-icon :icon="['fas', 'xmark']" />
                    </button>
                </header>
                <div class="quote-content" aria-live="polite">
                    <p v-if="state?.message?.revoke">
                        {{ $t('消息已撤回') }}
                    </p>
                    <template v-else-if="state?.status === 'ready'">
                        <div class="quote-author">
                            <strong>{{ state.message.sender.card || state.message.sender.nickname }}</strong>
                            <time>{{ time }}</time>
                        </div>
                        <MsgBody :key="quotes.viewerId" :data="state.message" type="body"
                            id-prefix="quote-original-" />
                    </template>
                    <div v-else-if="state?.status === 'error'" class="quote-status">
                        <p>{{ state.failure === 'timeout' ? $t('加载引用消息超时') : $t('原消息暂不可用') }}</p>
                        <button type="button" class="ss-button" @click="retry">
                            {{ $t('重试') }}
                        </button>
                    </div>
                    <p v-else>
                        {{ $t('正在加载引用消息……') }}
                    </p>
                </div>
                <footer>
                    <button type="button" class="ss-button" @click="quotes.close">
                        {{ $t('返回聊天') }}
                    </button>
                </footer>
            </dialog>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import MsgBody from './MsgBody.vue'
import { i18n } from '@renderer/main'
import { useQuotedMessagesStore } from '@renderer/state/quotedMessages'
import { getTrueLang, getViewTime } from '@renderer/function/utils/systemUtil'

defineOptions({ name: 'QuotedMessagePan' })
const $t = i18n.global.t
const quotes = useQuotedMessagesStore()
const panel = ref<HTMLElement | null>(null)
const state = computed(() => quotes.viewerId === null ? undefined : quotes.entry(quotes.viewerId))
const time = computed(() => state.value?.message && !state.value.message.revoke ?new Intl.DateTimeFormat(getTrueLang(), { dateStyle: 'medium', timeStyle: 'short' })
        .format(getViewTime(Number(state.value.message.time))) : '')
let previousFocus: HTMLElement | null = null

watch(() => quotes.viewerId, async (id, previous) => {
    if (id === null) {
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
        previousFocus = null
        return
    }
    if (previous === null) previousFocus = document.activeElement as HTMLElement
    await nextTick()
    if (quotes.viewerId === id) panel.value?.focus()
})

function retry() {
    if (quotes.viewerId !== null) {
        // The retry button disappears while loading; keep keyboard focus in the dialog.
        panel.value?.focus()
        void quotes.load(quotes.viewerId, true)
    }
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.stopPropagation()
        quotes.close()
    } else if (event.key === 'Tab') {
        const focusable = panel.value?.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]')
        if (!focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
            event.preventDefault()
            last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) {
            event.preventDefault()
            first.focus()
        }
    }
}
onUnmounted(quotes.close)
</script>

<style scoped>
.quote-overlay {
    position: fixed;
    inset: 0;
    z-index: 98;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
}
.quote-backdrop { position: absolute; inset: 0; border: 0; background: #0007; }
.quote-panel {
    position: relative;
    margin: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    width: min(560px, 100%);
    max-height: 80dvh;
    padding: 0;
    color: var(--color-font);
    overflow: hidden;
}
.quote-panel header, .quote-panel footer { display: flex; align-items: center; padding: 18px 22px; gap: 16px; }
.quote-panel header { justify-content: space-between; }
.quote-panel h2 { margin: 0; font-size: 1rem; }
.quote-panel header button { background: transparent; border: 0; color: inherit; padding: 8px; cursor: pointer; }
.quote-panel footer { justify-content: flex-end; }
.quote-content { padding: 4px 22px 18px; overflow: auto; min-height: 80px; }
.quote-author { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 16px; border-left: 3px solid var(--color-main); padding-left: 12px; }
.quote-author strong { font-size: 0.9rem; }
.quote-author time { font-size: 0.8rem; color: var(--color-font-2); }
.quote-status { padding: 16px 0; }
.quote-content :deep(.message.body-only) { max-width: 100%; }
.quote-content :deep(.message-body) { max-width: 100%; overflow-wrap: anywhere; }
.quote-panel button:focus-visible { outline: 2px solid var(--color-main); outline-offset: 2px; }
@media (max-width: 500px) {
    .quote-overlay { padding: 12px; }
    .quote-panel { max-height: calc(100dvh - 24px); }
}
</style>
