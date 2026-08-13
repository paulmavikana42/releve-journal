' Lance Releve avec la fenetre REDUITE, pas cachee.
'
' La version precedente masquait completement la console (style 0). Consequence :
' toute erreur devenait invisible et l'app "ne s'ouvrait plus" sans aucun message.
' Un echec silencieux est pire qu'un echec visible.
'
' Style 7 = reduite dans la barre des taches : discrete, mais consultable.
' Clic droit -> Envoyer vers -> Bureau, pour avoir une icone.

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

dossier = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dossier

bat = dossier & "\Releve.bat"
If Not fso.FileExists(bat) Then
    MsgBox "Releve.bat est introuvable." & vbCrLf & vbCrLf & _
           "Le .vbs doit rester dans le meme dossier que Releve.bat.", _
           16, "Releve"
    WScript.Quit 1
End If

sh.Run """" & bat & """", 7, False
