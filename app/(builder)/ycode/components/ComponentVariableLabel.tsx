'use client';

/**
 * Reusable label with dropdown for linking/creating component variables.
 * Shows a "+" button in component edit mode, or a plain label otherwise.
 */

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import Icon, { type IconProps } from '@/components/ui/icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { ComponentVariable } from '@/types';

export const VARIABLE_TYPE_ICONS: Record<string, IconProps['name']> = {
  text: 'text',
  rich_text: 'rich-text',
  image: 'image',
  link: 'link',
  audio: 'audio',
  video: 'video',
  icon: 'icon',
  variant: 'component',
};

interface ComponentVariableLabelProps {
  /** Label text (e.g. "Content", "Source", "Type") */
  label: string;
  /** Whether the user is editing a component */
  isEditingComponent: boolean;
  /** Filtered list of variables matching this type */
  variables: ComponentVariable[];
  /** Currently linked variable ID */
  linkedVariableId?: string;
  /** Called when the user selects a variable to link */
  onLinkVariable: (variableId: string) => void;
  /** Called to open the variables dialog */
  onManageVariables: () => void;
  /** Called to create a new variable of this type with current values as defaults */
  onCreateVariable?: () => void;
  /** Extra className for the outer wrapper */
  className?: string;
}

export default function ComponentVariableLabel({
  label,
  isEditingComponent,
  variables,
  linkedVariableId,
  onLinkVariable,
  onManageVariables,
  onCreateVariable,
  className,
}: ComponentVariableLabelProps) {
  if (!isEditingComponent) {
    return <Label variant="muted" className={className}>{label}</Label>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="variable"
          size="xs"
          className="has-[>svg]:px-0"
        >
          <Icon name="plus-circle-solid" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {variables.length > 0 && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Link to variable</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {variables.map((variable) => (
                    <DropdownMenuItem
                      key={variable.id}
                      onClick={() => onLinkVariable(variable.id)}
                    >
                      {variable.type && VARIABLE_TYPE_ICONS[variable.type] && (
                        <Icon
                          name={VARIABLE_TYPE_ICONS[variable.type]}
                          className="size-3 opacity-60"
                        />
                      )}
                      {variable.name}
                      {linkedVariableId === variable.id && (
                        <Icon name="check" className="ml-auto size-3" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}
        {onCreateVariable && (
          <DropdownMenuItem
            onClick={onCreateVariable}
            disabled={!!linkedVariableId}
          >
            Create variable
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onManageVariables}>
          Manage variables
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
