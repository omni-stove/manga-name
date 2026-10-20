import { m } from '@manga/i18n'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'
import { FileDrop } from './file-drop'

const meta = {
  component: FileDrop,
  args: { label: '参照画像', accept: 'image/png,image/jpeg', name: 'reference' },
} satisfies Meta<typeof FileDrop>

export default meta
type Story = StoryObj<typeof meta>

const png = () => new File(['png'], 'face.png', { type: 'image/png' })

export const Empty: Story = {
  args: { hint: '選ばなければ外見から生成します' },
  play: async ({ canvas }) => {
    const input = canvas.getByLabelText('参照画像')
    await expect(input).toHaveAttribute('type', 'file')
    await expect(input).toHaveAccessibleDescription('選ばなければ外見から生成します')
    await expect(canvas.getByText(m.ui_file_drop_choose())).toBeVisible()
  },
}

export const Disabled: Story = { args: { disabled: true } }

export const WithError: Story = { args: { error: '読み込めませんでした' } }

// 操作するとファイルが残るので、見た目のストーリーとは分ける

export const ShowsPickedFileName: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(canvas.getByLabelText('参照画像'), png())
    await expect(canvas.getByText('face.png')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: m.ui_file_drop_clear() }))
    await expect(canvas.queryByText('face.png')).toBeNull()
    await expect(canvas.getByLabelText<HTMLInputElement>('参照画像').files).toHaveLength(0)
  },
}

export const PicksOnce: Story = {
  args: { name: undefined, onPick: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.upload(canvas.getByLabelText('参照画像'), png())
    await expect(args.onPick).toHaveBeenCalledOnce()
    await expect(canvas.queryByText('face.png')).toBeNull()
  },
}

export const RejectsDroppedType: Story = {
  args: { onPick: fn() },
  play: async ({ args, canvas }) => {
    const zone = canvas.getByText(m.ui_file_drop_prompt())
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['{}'], 'project.json', { type: 'application/json' }))
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    await expect(await canvas.findByText(m.ui_file_drop_rejected())).toBeVisible()
    await expect(args.onPick).not.toHaveBeenCalled()
  },
}
