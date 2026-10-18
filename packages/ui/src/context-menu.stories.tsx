import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'
import { ContextMenu } from './context-menu'

const undo = fn()
const fit = fn()

const meta = {
  component: ContextMenu,
  args: {
    label: 'ページのメニュー',
    x: 40,
    y: 40,
    items: [
      { label: 'Undo', shortcut: '⌘Z', onSelect: undo },
      { label: 'Redo', shortcut: '⌘Shift+Z', disabled: true, onSelect: fn() },
      'separator',
      { label: '全体を表示', onSelect: fit },
    ],
    onClose: fn(),
  },
} satisfies Meta<typeof ContextMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

// フォーカスが移るので、見た目のストーリーとは分ける
export const ArrowKeysSkipDisabledItems: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('menuitem', { name: /Undo/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(canvas.getByRole('menuitem', { name: '全体を表示' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(fit).toHaveBeenCalled()
    await expect(args.onClose).toHaveBeenCalled()
  },
}

export const EscapeCloses: Story = {
  play: async ({ args, userEvent }) => {
    await userEvent.keyboard('{Escape}')
    await expect(args.onClose).toHaveBeenCalled()
    await expect(undo).not.toHaveBeenCalled()
  },
}

export const RadioItems: Story = {
  args: {
    label: 'フキダシの形',
    items: [
      { label: '普通', checked: true, onSelect: fn() },
      { label: '叫び', checked: false, onSelect: fn() },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('menuitemradio', { name: /普通/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(canvas.getByRole('menuitemradio', { name: /叫び/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  },
}
