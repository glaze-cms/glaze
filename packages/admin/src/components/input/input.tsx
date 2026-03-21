import classNames from 'classnames';
import { Input as BaseInput } from '@base-ui/react';

/* Styles */
import './input.css';

/* Types */
import type { WithClassName } from '@/types/utils';
import type { InputHTMLAttributes, ReactElement } from 'react';

interface InputProps extends WithClassName<
	InputHTMLAttributes<HTMLInputElement>
> {
	LeftIcon?: ReactElement;
}

export function Input({ className, LeftIcon, ...props }: InputProps) {
	return (
		<div className={classNames('input-container', className)}>
			{LeftIcon && <span className="left-icon">{LeftIcon}</span>}
			<BaseInput
				placeholder="Search"
				type="text"
				className={classNames('input', { 'with-left-icon': LeftIcon })}
				{...props}
			/>
		</div>
	);
}
