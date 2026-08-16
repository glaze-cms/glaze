import { Input as BaseInput } from '@base-ui/react';
import classNames from 'classnames';

import type { WithClassName } from '@/types';
import type { InputHTMLAttributes, ReactElement } from 'react';

import './input.css';

interface InputProps extends WithClassName<InputHTMLAttributes<HTMLInputElement>> {
	LeftIcon?: ReactElement;
	variant?: 'small' | 'large';
}

/**
 * A text input with an optional leading icon, wrapping Base UI's unstyled primitive.
 *
 * @param props.LeftIcon - Icon rendered inside the field, before the text.
 * @param props.variant - Height scale.
 * @returns The input, wrapped in its positioning container.
 */
export function Input({
	className,
	LeftIcon,
	variant = 'large',
	type = 'text',
	...props
}: InputProps) {
	return (
		<div className={classNames('input-container', className)}>
			{LeftIcon && (
				<span className="left-icon" aria-hidden="true">
					{LeftIcon}
				</span>
			)}
			<BaseInput
				type={type}
				className={classNames('input', variant, { 'with-left-icon': LeftIcon })}
				{...props}
			/>
		</div>
	);
}
