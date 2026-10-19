import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'
import { Button } from './button'
import { Dialog } from './dialog'
import { Input } from './field'
import { Typography } from './typography'

const meta = {
  component: Dialog,
  args: { title: 'ページを追加', onClose: fn() },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const Message: Story = {
  args: {
    children: <Typography>新しいページを末尾に追加します。</Typography>,
  },
}

export const WithForm: Story = {
  args: {
    onSubmit: fn(),
    children: <Input label="ページ名" name="name" />,
    actions: (
      <>
        <Button>キャンセル</Button>
        <Button type="submit" variant="primary">
          追加
        </Button>
      </>
    ),
  },
}

// 操作するとダイアログが閉じたり入力が残ったりするので、見た目のストーリーとは分ける。
// showModal で top layer に出るので、canvas ではなく screen から探す

export const CloseRequestCallsOnClose: Story = {
  ...Message,
  play: async ({ args }) => {
    const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'ページを追加' })
    await expect(dialog).toHaveAttribute('open')
    // userEvent の Esc は合成イベントで、ブラウザの閉じる要求にならない。Esc と同じ cancel→close を起こす
    dialog.requestClose()
    await waitFor(() => expect(args.onClose).toHaveBeenCalledOnce())
  },
}

export const BackdropClickCallsOnClose: Story = {
  ...Message,
  play: async ({ args }) => {
    const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'ページを追加' })
    // 背景のクリックは dialog 自身に届くので、枠の外の座標で押す
    await userEvent.pointer({
      keys: '[MouseLeft]',
      target: dialog,
      coords: { clientX: 1, clientY: 1 },
    })
    await waitFor(() => expect(args.onClose).toHaveBeenCalledOnce())
  },
}

export const ClickInsideKeepsOpen: Story = {
  ...Message,
  play: async ({ args }) => {
    const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'ページを追加' })
    const r = dialog.getBoundingClientRect()
    // 余白も dialog 自身に届くので、枠の内側の余白で押す
    await userEvent.pointer({
      keys: '[MouseLeft]',
      target: dialog,
      coords: { clientX: r.left + 4, clientY: r.top + 4 },
    })
    await expect(dialog).toHaveAttribute('open')
    await expect(args.onClose).not.toHaveBeenCalled()
  },
}

export const EnterAndSubmitCallOnSubmit: Story = {
  ...WithForm,
  play: async ({ args }) => {
    await userEvent.type(screen.getByRole('textbox', { name: 'ページ名' }), '見開き{Enter}')
    await expect(args.onSubmit).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: '追加' }))
    await expect(args.onSubmit).toHaveBeenCalledTimes(2)
  },
}
