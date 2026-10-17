import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { YStack } from './stack'
import { Typography } from './typography'

const meta = {
  component: Typography,
  args: { children: '第一話 はじまり' },
} satisfies Meta<typeof Typography>

export default meta
type Story = StoryObj<typeof meta>

export const Variants: Story = {
  render: (args) => (
    <YStack gap={12}>
      <Typography {...args} variant="title" />
      <Typography {...args} variant="heading" />
      <Typography {...args} variant="subheading" />
      <Typography {...args} variant="body" />
      <Typography {...args} variant="caption" />
      <Typography {...args} variant="label" />
    </YStack>
  ),
  play: async ({ canvas }) => {
    const [title, heading, , body] = canvas.getAllByText('第一話 はじまり')
    if (!title || !heading || !body) throw new Error('段階が足りない')
    await expect(title.getBoundingClientRect().height).toBeGreaterThan(
      heading.getBoundingClientRect().height,
    )
    await expect(getComputedStyle(body).marginTop).toBe('0px')
  },
}

export const Muted: Story = { args: { tone: 'muted', children: 'まだページがありません。' } }

export const Alert: Story = {
  args: { tone: 'alert', role: 'alert', children: '保存できません\nもう一度試してください' },
  play: async ({ canvas }) => {
    // 改行を保つので 2 行になる
    const alert = canvas.getByRole('alert')
    const lineHeight = Number.parseFloat(getComputedStyle(alert).lineHeight)
    await expect(alert.getBoundingClientRect().height).toBeGreaterThan(lineHeight * 1.5)
  },
}

export const AsSpan: Story = {
  args: { as: 'span', variant: 'caption' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('第一話 はじまり').tagName).toBe('SPAN')
  },
}
