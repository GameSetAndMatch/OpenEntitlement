/** Public authoring contract. Environment bindings exist only on boolean privileges. */
export type Visibility='hidden'|'read_only'|'editable';
export interface PrivilegeBase {key:string;title:string;description:string;visibility:Visibility;group_id?:string;tags:string[]}
export interface BooleanPrivilege extends PrivilegeBase {type:'boolean';default?:boolean;env_override?:string}
export interface IntegerPrivilege extends PrivilegeBase {type:'integer';default?:number|{unlimited:true};minimum?:number;maximum?:number;unlimited?:boolean}
export interface StringEnumPrivilege extends PrivilegeBase {type:'enum';enum:string[];default?:string}
export type Privilege=BooleanPrivilege|IntegerPrivilege|StringEnumPrivilege;
