import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Button } from './button'
import { XStack, YStack } from './stack'

const items = ['PNG', 'PDF', 'クラウドに保存', '共有リンクをコピー', '削除']

const meta = {
  component: XStack,
  args: {
    children: items.map((label) => <Button key={label}>{label}</Button>),
  },
} satisfies Meta<typeof XStack>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  play: async ({ canvas }) => {
    const [first, second] = canvas.getAllByRole('button')
    if (!first || !second) throw new Error('ボタンが足りない')
    await expect(second.getBoundingClientRect().top).toBe(first.getBoundingClientRect().top)
    await expect(second.getBoundingClientRect().left).toBeGreaterThan(
      first.getBoundingClientRect().right,
    )
  },
}

export const Wrap: Story = {
  args: { wrap: true, rowGap: 12, style: { width: '16rem' } },
  play: async ({ canvas }) => {
    const buttons = canvas.getAllByRole('button')
    const tops = new Set(buttons.map((b) => b.getBoundingClientRect().top))
    await expect(tops.size).toBeGreaterThan(1)
  },
}

export const Between: Story = {
  args: {
    justify: 'between',
    children: [<strong key="title">第一話</strong>, <Button key="action">書き出し</Button>],
  },
  play: async ({ canvasElement, canvas }) => {
    const stack = canvasElement.firstElementChild
    if (!stack) throw new Error('XStack が描かれていない')
    await expect(canvas.getByRole('button').getBoundingClientRect().right).toBe(
      stack.getBoundingClientRect().right,
    )
  },
}

export const Vertical: StoryObj<typeof YStack> = {
  render: (args) => <YStack {...args} />,
  args: {
    gap: 12,
    children: items.map((label) => <Button key={label}>{label}</Button>),
  },
  play: async ({ canvas }) => {
    const [first, second] = canvas.getAllByRole('button')
    if (!first || !second) throw new Error('ボタンが足りない')
    await expect(second.getBoundingClientRect().left).toBe(first.getBoundingClientRect().left)
    await expect(second.getBoundingClientRect().top).toBeGreaterThan(
      first.getBoundingClientRect().bottom,
    )
  },
}

export const Nested: StoryObj<typeof YStack> = {
  render: (args) => <YStack {...args} />,
  args: {
    gap: 16,
    justify: 'between',
    style: { height: '12rem' },
    children: [
      <strong key="title">参加者</strong>,
      <XStack key="actions">
        <Button>保存</Button>
        <Button variant="ghost">キャンセル</Button>
      </XStack>,
    ],
  },
  play: async ({ canvas }) => {
    // 揃えは CSS 変数で渡すので、子の XStack が親の between を継承せず、既定の start で詰めて並ぶ
    const save = canvas.getByRole('button', { name: '保存' }).getBoundingClientRect()
    const cancel = canvas.getByRole('button', { name: 'キャンセル' }).getBoundingClientRect()
    await expect(cancel.left - save.right).toBe(8)
  },
}
