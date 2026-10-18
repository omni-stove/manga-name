import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'
import { Button, IconButton, RemoveButton } from './button'

const meta = {
  component: Button,
  args: { children: '保存', onClick: fn() },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Secondary: Story = {}

export const Primary: Story = { args: { variant: 'primary' } }

export const Ghost: Story = { args: { variant: 'ghost' } }

export const Danger: Story = { args: { variant: 'danger', children: '削除' } }

export const Small: Story = { args: { size: 'small' } }

export const Disabled: Story = { args: { disabled: true } }

export const Icon: StoryObj<typeof IconButton> = {
  render: (args) => <IconButton {...args} />,
  args: { label: '閉じる', children: '×', onClick: fn() },
}

export const Remove: StoryObj<typeof RemoveButton> = {
  render: (args) => <RemoveButton {...args} />,
  args: { label: '削除', size: 'small', onClick: fn() },
}

// 操作後のフォーカスやホバーが見た目に残るので、見た目のストーリーとは分ける

export const ClickCallsOnClick: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: '保存' })
    await expect(button).toHaveAttribute('type', 'button')
    await userEvent.click(button)
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

export const DisabledIgnoresClick: Story = {
  ...Disabled,
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: '保存' }))
    await expect(args.onClick).not.toHaveBeenCalled()
  },
}

export const IconClickCallsOnClick: typeof Icon = {
  ...Icon,
  play: async ({ args, canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: '閉じる' })
    await expect(button).toHaveAttribute('title', '閉じる')
    await userEvent.click(button)
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}
