import { SelectMenu } from './ui/SelectMenu'

export interface SearchableOption {
  id: string
  label: string
  sublabel?: string
  disabled?: boolean
  disabledReason?: string
}

export function SearchableSelect({ options, value, onChange, placeholder, disabled, className }: {
  options: SearchableOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <SelectMenu
      className={className}
      options={options.map(option => ({
        value: option.id,
        label: option.label,
        description: option.disabled ? (option.disabledReason ?? option.sublabel) : option.sublabel,
        disabled: option.disabled,
      }))}
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? 'Select an option'}
      ariaLabel={placeholder ?? 'Search and select an option'}
      disabled={disabled}
      searchable
      size="sm"
    />
  )
}
