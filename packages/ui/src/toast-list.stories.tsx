import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'
import { ToastList } from './toast-list'

const meta = {
  component: ToastList,
  args: {
    items: [
      { id: 1, kind: 'info', message: 'クラウドに保存しました' },
      { id: 2, kind: 'error', message: '書き出しに失敗しました' },
    ],
    onDismiss: fn(),
  },
} satisfies Meta<typeof ToastList>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvas }) => {
    const alerts = canvas.getAllByRole('alert')
    await expect(alerts).toHaveLength(2)
    await expect(alerts[1]).toHaveTextContent('書き出しに失敗しました')
  },
}

export const Empty: Story = {
  args: { items: [] },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('list')).toBeNull()
  },
}

// 押した閉じるボタンにフォーカスが残るので、見た目のストーリーとは分ける
export const CloseCallsOnDismiss: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const [, close] = canvas.getAllByRole('button', { name: '閉じる' })
    if (close) await userEvent.click(close)
    await expect(args.onDismiss).toHaveBeenCalledWith(2)
  },
}
