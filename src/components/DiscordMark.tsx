/**
 * La marque de Discord, dessinee.
 *
 * En chemin plutot qu'en image : le bouton doit paraitre avec le reste de la
 * page, et une icone telechargee arrive apres — on verrait un trou, puis un
 * saut. Elle reprend la couleur du texte du bouton, ce qui la rend juste sur un
 * fond clair comme sur un fond sombre, sans deuxieme fichier.
 */
export function DiscordMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M20.32 4.57A19.79 19.79 0 0 0 15.43 3c-.24.42-.5.98-.69 1.43a18.4 18.4 0 0 0-5.48 0C9.07 3.98 8.8 3.42 8.57 3a19.74 19.74 0 0 0-4.9 1.57C.57 9.21-.27 13.73.15 18.19A19.9 19.9 0 0 0 6.19 21.2c.49-.66.92-1.37 1.29-2.11-.71-.27-1.39-.6-2.03-.98.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.1 0c.16.14.33.27.5.4-.64.38-1.32.71-2.03.98.37.74.8 1.45 1.29 2.11a19.87 19.87 0 0 0 6.04-3.01c.5-5.18-.84-9.66-3.53-13.62ZM8.02 15.45c-1.18 0-2.15-1.09-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.33-.95 2.42-2.15 2.42Zm7.96 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.09 2.15 2.42 0 1.33-.94 2.42-2.15 2.42Z"
      />
    </svg>
  );
}
