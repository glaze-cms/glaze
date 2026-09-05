import type { Translations } from './types.ts';

/** Spanish. Typed as {@link Translations}, so a missing or misspelled key is a compile error. */
export const es: Translations = {
	app: {
		name: 'Glaze',
	},
	common: {
		cancel: 'Cancelar',
		retry: 'Reintentar',
		loading: 'Cargando…',
	},
	nav: {
		overview: 'Resumen',
		toggleSidebar: 'Alternar',
		openPanel: 'Abrir la barra lateral',
		closePanel: 'Cerrar el panel',
		search: 'Buscar',
		collections: 'Colecciones',
		noCollections: 'Aún no hay colecciones',
		newEntity: 'Nueva colección',
		newEntityNotAvailable: 'La edición de entidades aún no está disponible',
		signOut: 'Cerrar sesión',
	},
	auth: {
		signIn: {
			title: 'Inicia sesión en Glaze',
			subtitle: 'Usa la cuenta que creaste para este proyecto.',
			email: 'Correo electrónico',
			emailPlaceholder: 'tu@ejemplo.com',
			password: 'Contraseña',
			passwordPlaceholder: 'Tu contraseña',
			submit: 'Iniciar sesión',
			submitting: 'Iniciando sesión…',
			failed: 'Correo o contraseña incorrectos.',
			noAccount: '¿Aún no tienes cuenta?',
			createOne: 'Crea una',
		},
		signUp: {
			title: 'Crea tu cuenta de Glaze',
			subtitle: 'La primera cuenta que crees será la cuenta de administración.',
			name: 'Nombre',
			namePlaceholder: 'Ada Lovelace',
			submit: 'Crear cuenta',
			submitting: 'Creando la cuenta…',
			failed: 'No se pudo crear la cuenta.',
			haveAccount: '¿Ya tienes una cuenta?',
			signIn: 'Inicia sesión',
		},
	},
	errors: {
		bootstrap: {
			title: 'Glaze no pudo iniciarse',
			body: 'El panel no pudo conectarse con el servidor de Glaze. Comprueba que esté en ejecución y vuelve a intentarlo.',
		},
		notFound: {
			title: 'Página no encontrada',
			body: 'Esa página no existe.',
			back: 'Volver a Glaze',
		},
		unexpected: {
			title: 'Algo salió mal',
			body: 'Se produjo un error inesperado al mostrar esta página.',
		},
	},
};
