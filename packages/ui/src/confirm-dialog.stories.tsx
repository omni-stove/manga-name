import { m } from '@manga/i18n'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent } from 'storybook/test'
import { ConfirmDialog } from './confirm-dialog'

const meta = {
  component: ConfirmDialog,
  args: {
    title: 'エピソードを削除',
    message: '「第1話」とその 3 ページを削除しますか？',
    confirmLabel: '削除',
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Undoable: Story = {}

export const Irreversible: Story = {
  args: {
    title: 'プロジェクトを削除',
    message: '「新作」を削除しますか？元に戻せません。',
    irreversible: true,
  },
}

// showModal で top layer に出るので、canvas ではなく screen から探す

export const ConfirmCallsOnConfirm: Story = {
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: '削除' }))
    await expect(args.onConfirm).toHaveBeenCalledOnce()
    await expect(args.onCancel).not.toHaveBeenCalled()
  },
}

export const BackdropClickKeepsOpen: Story = {
  play: async ({ args }) => {
    const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'エピソードを削除' })
    await userEvent.pointer({ keys: '[MouseLeft]', target: dialog, coords: { clientX: 1, clientY: 1 } })
    await expect(dialog).toHaveAttribute('open')
    await expect(args.onCancel).not.toHaveBeenCalled()
  },
}

export const CancelCallsOnCancel: Story = {
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: m.cancel() }))
    await expect(args.onCancel).toHaveBeenCalledOnce()
    await expect(args.onConfirm).not.toHaveBeenCalled()
  },
}
